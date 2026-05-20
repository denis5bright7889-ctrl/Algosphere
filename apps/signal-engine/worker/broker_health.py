"""
Broker connection health probe.

Runs on a schedule: for every row in broker_connections, attempt to
build the per-user adapter, refresh its state, and write the resolved
state back so the /brokers UI shows a live, explainable status.

State machine (defined in risk.broker_state.BrokerState):
  PENDING   – newly saved; we haven't checked yet. Capped at
              MAX_PENDING_CYCLES (2) probe cycles. After the cap,
              flips to FAILED with reason "handshake timeout".
  CONNECTED – adapter.connect() + refresh_state() succeeded; equity
              fresh.
  FAILED    – last probe errored; error_message names the cause. User
              can retry from the UI.
  DISABLED  – broker is structurally unreachable in this environment
              (MT5 on Linux). Never retried automatically — the probe
              skips DISABLED rows entirely.

State transitions trigger an optional Telegram notification to the
owner via notifier.dispatch_broker_state_change — best-effort and
never raises.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
from risk.adapters.factory import (
    get_adapter_for_user, BrokerNotConnected, BrokerDecryptError,
    BrokerDisabled, drop_cache,
)
from risk.broker_state import BrokerState, MAX_PENDING_CYCLES, disabled_reason_for

# Brokers the factory can actually build today (regardless of
# environment availability — DISABLED detection happens inside the
# factory). cTrader is in the DB constraint but has no adapter yet.
PROBEABLE = {'binance', 'bybit', 'okx', 'mt5', 'paper'}

# Don't re-notify the user every probe cycle for the same state.
# Track the last-notified (conn_id, state) tuple in-process.
_last_notified: dict[str, str] = {}


class BrokerHealthProbe:
    def __init__(self):
        self.settings = get_settings()
        self._db: Optional[Client] = None

    def db(self) -> Client:
        if self._db is None:
            self._db = create_client(
                self.settings.supabase_url,
                self.settings.supabase_service_role_key,
            )
        return self._db

    async def probe_all(self) -> None:
        try:
            rows = (
                self.db().table('broker_connections')
                .select('id,user_id,broker,status,pending_cycles')
                .neq('status', BrokerState.REVOKED)
                .neq('status', BrokerState.DISABLED)
                .execute()
            ).data or []
        except Exception as e:
            logger.error(f"BrokerHealthProbe: list failed: {e}")
            return

        if not rows:
            return

        logger.info(f"BrokerHealthProbe: checking {len(rows)} connection(s)")
        for row in rows:
            await self._probe_one(row)

    async def _probe_one(self, row: dict) -> None:
        conn_id = row['id']
        user_id = row['user_id']
        broker  = row['broker']
        prev    = row.get('status', BrokerState.PENDING)
        now     = datetime.now(timezone.utc).isoformat()

        if broker not in PROBEABLE:
            return

        # Environment-level guard first: if MT5 is structurally
        # unavailable, never even attempt the handshake — flip to
        # DISABLED so the probe stops touching this row.
        env_disabled = disabled_reason_for(broker)
        if env_disabled is not None:
            await self._apply(conn_id, prev, {
                'status':         BrokerState.DISABLED,
                'error_message':  env_disabled,
                'last_synced_at': now,
                'pending_cycles': 0,
            }, user_id=user_id, broker=broker)
            return

        patch: dict = {'last_synced_at': now}
        new_state: Optional[str] = None
        try:
            adapter = await get_adapter_for_user(self.db(), user_id, broker)
            await adapter.refresh_state()
            equity = adapter.get_equity()
            connected = adapter.is_connected()

            new_state = BrokerState.CONNECTED if connected else BrokerState.FAILED
            patch['status']        = new_state
            patch['error_message'] = None if connected else 'adapter reported not connected after refresh'
            patch['pending_cycles'] = 0
            if equity is not None:
                patch['equity_usd']        = equity
                patch['equity_updated_at'] = now
        except BrokerDisabled as e:
            new_state = BrokerState.DISABLED
            patch['status']         = new_state
            patch['error_message']  = str(e)
            patch['pending_cycles'] = 0
        except BrokerNotConnected as e:
            new_state = BrokerState.FAILED
            patch['status']         = new_state
            patch['error_message']  = f'not connected: {e}'
            patch['pending_cycles'] = 0
        except BrokerDecryptError as e:
            new_state = BrokerState.FAILED
            patch['status']         = new_state
            patch['error_message']  = (
                f'credential decrypt failed ({e}) — was CREDENTIAL_ENCRYPTION_KEY rotated?'
            )
            patch['pending_cycles'] = 0
            await drop_cache(user_id, broker)
        except Exception as e:
            # Pending-cap rule: if a fresh row is taking longer than
            # MAX_PENDING_CYCLES probes to handshake, stop telling the
            # user "pending" and flip to FAILED with a clear reason.
            cycles = int(row.get('pending_cycles') or 0) + 1
            if prev == BrokerState.PENDING and cycles >= MAX_PENDING_CYCLES:
                new_state = BrokerState.FAILED
                patch['status']         = new_state
                patch['error_message']  = (
                    f'handshake timeout after {cycles} probe cycles. Last error: '
                    + str(e)[:240]
                )
                patch['pending_cycles'] = 0
            else:
                # Stay in (or transition into) pending and bump the counter.
                new_state = BrokerState.PENDING
                patch['status']         = new_state
                patch['error_message']  = str(e)[:300]
                patch['pending_cycles'] = cycles
            await drop_cache(user_id, broker)

        await self._apply(conn_id, prev, patch, user_id=user_id, broker=broker)

    async def _apply(
        self,
        conn_id: str,
        prev:    str,
        patch:   dict,
        *,
        user_id: str,
        broker:  str,
    ) -> None:
        """Write the patch back to broker_connections and fire a
        state-change notification if the state actually changed."""
        new_state = patch.get('status', prev)
        if new_state != prev:
            patch['state_changed_at'] = patch.get('last_synced_at') or (
                datetime.now(timezone.utc).isoformat()
            )

        try:
            (
                self.db().table('broker_connections')
                .update(patch)
                .eq('id', conn_id)
                .execute()
            )
        except Exception as e:
            logger.warning(f"BrokerHealthProbe: write-back failed for {conn_id}: {e}")
            return

        if new_state != prev and new_state in {
            BrokerState.CONNECTED, BrokerState.FAILED, BrokerState.DISABLED,
        }:
            # Don't re-notify on every probe if the state hasn't actually
            # changed since last alert (probe runs every 10 min — without
            # this guard a flaky broker would spam Telegram).
            key = f"{conn_id}"
            if _last_notified.get(key) == new_state:
                return
            _last_notified[key] = new_state

            try:
                from notifier import dispatch_broker_state_change
                asyncio.create_task(dispatch_broker_state_change(
                    user_id   = user_id,
                    broker    = broker,
                    new_state = new_state,
                    reason    = patch.get('error_message'),
                ))
            except Exception as e:
                logger.debug(f"state-change notifier dispatch failed: {e}")
