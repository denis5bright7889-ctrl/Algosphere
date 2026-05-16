"""
Broker connection health probe.

Runs on a schedule: for every row in broker_connections, build the
per-user adapter, refresh its state, and write the result back so the
/brokers UI shows a live red/green dot + equity.

Writes:
  status            connected | error
  equity_usd        from adapter.get_equity()
  equity_updated_at when equity was non-null
  last_synced_at    every probe
  error_message     populated on failure, cleared on success

Failures are isolated per-connection — one bad key never blocks the
rest. Decrypt failures (rotated CREDENTIAL_ENCRYPTION_KEY) surface as
status='error' with a clear message rather than a silent skip.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
from risk.adapters.factory import (
    get_adapter_for_user, BrokerNotConnected, BrokerDecryptError, drop_cache,
)

# Brokers the factory can actually build today. cTrader is declared in
# the table constraint but has no adapter yet — skip it cleanly.
PROBEABLE = {'binance', 'bybit', 'okx', 'mt5'}


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
                .select('id,user_id,broker,status')
                .neq('status', 'revoked')
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
        now     = datetime.now(timezone.utc).isoformat()

        if broker not in PROBEABLE:
            return

        patch: dict = {'last_synced_at': now}
        try:
            adapter = await get_adapter_for_user(self.db(), user_id, broker)
            await adapter.refresh_state()
            equity = adapter.get_equity()
            connected = adapter.is_connected()

            patch['status'] = 'connected' if connected else 'error'
            patch['error_message'] = None if connected else 'adapter not connected'
            if equity is not None:
                patch['equity_usd'] = equity
                patch['equity_updated_at'] = now
        except BrokerNotConnected as e:
            patch['status'] = 'error'
            patch['error_message'] = f'not connected: {e}'
        except BrokerDecryptError as e:
            patch['status'] = 'error'
            patch['error_message'] = (
                f'credential decrypt failed ({e}) — was CREDENTIAL_ENCRYPTION_KEY rotated?'
            )
            await drop_cache(user_id, broker)
        except Exception as e:
            patch['status'] = 'error'
            patch['error_message'] = str(e)[:300]
            # Rebuild from scratch next cycle in case the session went stale
            await drop_cache(user_id, broker)

        try:
            (
                self.db().table('broker_connections')
                .update(patch)
                .eq('id', conn_id)
                .execute()
            )
        except Exception as e:
            logger.warning(f"BrokerHealthProbe: write-back failed for {conn_id}: {e}")
