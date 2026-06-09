"""
Broker Reality Sync Worker — the truth layer.

Brokers are the source of truth for trades; the DB is derived truth. This
worker closes the open loop at the execution/broker layer by polling each
connected broker's REAL open positions (read-only) and reconciling them
against `execution_events`:

  • A position open at the broker but absent from our events → an external
    / manual / missed trade. We inject an ORDER_FILLED execution_event
    (source='detected'). The journal auto-detection trigger (migration
    20240101000029) then creates the journal_entries row, and the
    execution_event_emit mirror writes `trade_open` to system_event_log —
    so journal + observability close automatically.
  • A position we previously tracked as open that has vanished from the
    broker → injected POSITION_CLOSED (the trigger closes the journal row).

Safety / honesty contract:
  • READ-ONLY on the broker side — only get_positions(); never submits or
    cancels orders.
  • Non-raising per connection; a broker error degrades to a health_alert,
    never crashes the loop or other connections.
  • Dedup via the execution_events open-set (keyed on broker position id),
    so a position is injected once, not every cycle.
  • DORMANT by default — gated on settings.broker_sync_enabled. Until an
    operator enables it (ideally with a LIVE broker connected; today all
    connections are testnet), it does nothing, so it never pollutes the
    journal with paper/testnet noise. This is a safety gate, not a stub.

Known v1 limitation: a detected close records the journal row as closed but
cannot fill exit price / realized PnL without a per-broker closed-trades
API. Those fields stay null until a closed-trade fetch is added per adapter.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
from risk.adapters.factory import (
    get_adapter_for_user, BrokerDisabled, BrokerNotConnected, BrokerDecryptError,
)
from risk.adapters.execution_event_emit import emit_execution_event
import system_events as obs


# How far back to read execution_events when rebuilding the open-set.
_OPEN_LOOKBACK_DAYS = 60


class BrokerReconciler:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._db: Optional[Client] = None

    def db(self) -> Client:
        if self._db is None:
            self._db = create_client(
                self.settings.supabase_url,
                self.settings.supabase_service_role_key,
            )
        return self._db

    # ─── Main scheduled entry point ──────────────────────────────────────

    async def reconcile_all(self) -> None:
        """Poll every connected broker and reconcile its real positions.
        Heartbeat is written every cycle so the diagnostics endpoint can
        prove the truth layer is alive."""
        obs.heartbeat('broker_reconciler', status='live')

        if not self.settings.has_supabase:
            return

        # Unique (user_id, broker) pairs that are currently connected. The
        # factory resolves the default/latest connection per pair, so we
        # dedupe to avoid building the same adapter twice.
        try:
            rows = (self.db().table('broker_connections')
                    .select('user_id, broker, status')
                    .eq('status', 'connected')
                    .execute()).data or []
        except Exception as e:
            obs.health_alert('broker_reconciler', f'connections fetch failed: {str(e)[:160]}')
            return

        pairs = sorted({(r['user_id'], r['broker']) for r in rows if r.get('user_id') and r.get('broker')})
        totals = {'connections': len(pairs), 'detected_open': 0, 'detected_closed': 0, 'errors': 0}

        for user_id, broker in pairs:
            try:
                d = await self._reconcile_pair(user_id, broker)
                totals['detected_open']   += d[0]
                totals['detected_closed'] += d[1]
            except Exception as e:
                totals['errors'] += 1
                logger.warning(f"broker_reconciler: {broker}/{user_id[:8]} raised: {e!r}")

        # One sync-trace per cycle so the loop is observable even when quiet.
        obs.emit('engine_event', payload={'event': 'broker_sync', **totals})
        logger.info(f"broker_reconciler cycle: {totals}")

    # ─── Per-connection reconciliation ───────────────────────────────────

    async def _reconcile_pair(self, user_id: str, broker: str) -> tuple[int, int]:
        """Returns (detected_open, detected_closed) counts for one pair."""
        try:
            adapter = await get_adapter_for_user(self.db(), user_id, broker)
            positions = await adapter.get_positions()
        except BrokerDisabled:
            return (0, 0)   # structurally unavailable (e.g. MT5 on Linux) — silent skip
        except (BrokerNotConnected, BrokerDecryptError) as e:
            obs.health_alert('broker_reconciler', f'{broker}/{user_id[:8]} adapter: {str(e)[:160]}')
            return (0, 0)

        broker_pos = {p.broker_pos_id: p for p in positions if getattr(p, 'broker_pos_id', None)}
        known_open = self._known_open_ids(user_id, broker)

        new_ids    = set(broker_pos) - known_open
        closed_ids = known_open - set(broker_pos)

        for pid in new_ids:
            p = broker_pos[pid]
            emit_execution_event(
                user_id=user_id, broker=broker, event_type='ORDER_FILLED',
                payload={
                    'order_id':       pid,
                    'position_id':    pid,
                    'broker_pos_id':  pid,
                    'symbol':         p.symbol,
                    'side':           'buy' if p.side == 'long' else 'sell',
                    'filled_qty':     float(p.qty),
                    'avg_fill_price': float(p.avg_entry),
                    'status':         'FILLED',
                    'source':         'detected',
                },
            )
            obs.emit('engine_event', payload={
                'event': 'external_trade_detected', 'broker': broker,
                'symbol': p.symbol, 'side': p.side, 'broker_pos_id': pid,
            })
            logger.warning(f"broker_reconciler: DETECTED external position {broker} {p.symbol} {p.side} (pos {pid})")

        # Enrich detected closes with real broker-history data. Only the
        # MT5 bridge adapter currently exposes get_closed_deals (Phase 1
        # of the close-enrichment work). Other adapters fall through to
        # the unenriched path until their adapters add the method.
        closed_deals_by_pos: dict[str, dict] = {}
        if closed_ids and hasattr(adapter, 'get_closed_deals'):
            try:
                # Look back the same window as the open-set so we always
                # find the matching close, even if the loop missed a cycle.
                since_epoch = int(
                    (datetime.now(timezone.utc) - timedelta(days=_OPEN_LOOKBACK_DAYS)).timestamp()
                )
                deals = await adapter.get_closed_deals(since_epoch)  # type: ignore[attr-defined]
                # First match wins per position_id (adapter returns
                # newest-first, latest-deal already deduped on the bridge).
                for d in deals or []:
                    posid = d.get('position_id')
                    if posid and posid in closed_ids and posid not in closed_deals_by_pos:
                        closed_deals_by_pos[posid] = d
            except Exception as e:
                logger.warning(f"broker_reconciler: get_closed_deals failed for {broker}: {e}")

        for pid in closed_ids:
            deal = closed_deals_by_pos.get(pid)
            payload: dict[str, object] = {
                'order_id':      pid,
                'position_id':   pid,
                'broker_pos_id': pid,
                'source':        'detected',
                'reason':        'broker_position_gone',
            }
            if deal:
                payload.update({
                    'enriched':     True,
                    'exit':         deal.get('exit_price'),
                    'realized_pnl': deal.get('realized_pnl'),
                    'commission':   deal.get('commission'),
                    'swap':         deal.get('swap'),
                    'close_time':   deal.get('close_time'),
                    'symbol':       deal.get('symbol'),
                    'volume':       deal.get('volume'),
                    'deal_id':      deal.get('deal_id'),
                })
            else:
                payload['enriched']      = False
                payload['enrich_reason'] = 'closed_deal_not_found'

            emit_execution_event(
                user_id=user_id, broker=broker, event_type='POSITION_CLOSED',
                payload=payload,
            )
            logger.info(
                f"broker_reconciler: detected close {broker} pos {pid} "
                f"enriched={bool(deal)}"
            )

        # Phase 4: backfill any earlier-detected closes that didn't carry
        # full enrichment data (e.g. trades closed before the Phase 3
        # enrichment landed, or cycles when get_closed_deals failed).
        # Re-fetch the broker's closed-deal table and patch any matching
        # journal row whose exit_price is still NULL.
        if hasattr(adapter, 'get_closed_deals'):
            try:
                backfilled = await self._backfill_unenriched_pair(user_id, broker, adapter)
                if backfilled:
                    logger.info(f"broker_reconciler: backfilled {backfilled} unenriched "
                                f"closes for {broker}/{user_id[:8]}")
            except Exception as e:
                logger.warning(f"broker_reconciler: backfill failed {broker}/{user_id[:8]}: {e}")

        return (len(new_ids), len(closed_ids))

    # ─── Backfill: re-enrich incomplete closes ─────────────────────────────
    async def _backfill_unenriched_pair(self, user_id: str, broker: str, adapter) -> int:
        """Find auto journal rows for this (user, broker) that closed
        without exit_price (the reconciler detected the close but the
        bridge hadn't yet exposed closed_deals or the call failed).
        Re-fetch the broker history and patch the rows. Idempotent —
        skips rows that already have exit_price.
        """
        # Pull the unenriched journal rows for this pair.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=_OPEN_LOOKBACK_DAYS)).isoformat()
        try:
            rows = (self.db().table('journal_entries')
                    .select('id, auto_position_id, exit_price, created_at')
                    .eq('user_id', user_id)
                    .eq('broker',  broker)
                    .is_('exit_price', 'null')
                    .not_.is_('auto_position_id', 'null')
                    .gte('created_at', cutoff)
                    .limit(500).execute()).data or []
        except Exception as e:
            logger.warning(f"backfill_unenriched: row fetch failed: {e}")
            return 0
        if not rows:
            return 0

        # Index unenriched rows by position id for O(1) lookup.
        unenriched = {str(r['auto_position_id']): r for r in rows if r.get('auto_position_id')}
        if not unenriched:
            return 0

        # One bridge call gives us every recent close for this account.
        since_epoch = int(
            (datetime.now(timezone.utc) - timedelta(days=_OPEN_LOOKBACK_DAYS)).timestamp()
        )
        deals = await adapter.get_closed_deals(since_epoch) or []

        patched = 0
        for d in deals:
            posid = str(d.get('position_id') or '')
            row = unenriched.get(posid)
            if row is None:
                continue
            # Compute duration_ms when we have both endpoints.
            close_iso = d.get('close_time')
            dur_ms = None
            if close_iso:
                try:
                    close_dt = datetime.fromisoformat(close_iso.replace('Z', '+00:00'))
                    open_dt  = datetime.fromisoformat(row['created_at'].replace('Z', '+00:00'))
                    dur_ms = int((close_dt - open_dt).total_seconds() * 1000)
                except Exception:
                    pass
            update = {
                'exit_price':  d.get('exit_price'),
                'pnl':         d.get('realized_pnl'),
                'commission':  d.get('commission'),
                'swap':        d.get('swap'),
                'closed_at':   close_iso,
            }
            if dur_ms is not None:
                update['duration_ms'] = dur_ms
            try:
                # Guard against a race where another cycle already
                # enriched it — only update when exit_price is still
                # NULL (Postgres-side guard via the WHERE).
                self.db().table('journal_entries').update(update)\
                    .eq('id', row['id']).is_('exit_price', 'null').execute()
                patched += 1
            except Exception as e:
                logger.warning(f"backfill_unenriched: update {row['id'][:8]} failed: {e}")

        return patched

    # ─── Open-set from execution_events ──────────────────────────────────

    def _known_open_ids(self, user_id: str, broker: str) -> set[str]:
        """Rebuild the set of broker position ids we currently believe are
        OPEN: those with an ORDER_FILLED and no later POSITION_CLOSED."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=_OPEN_LOOKBACK_DAYS)).isoformat()
        try:
            rows = (self.db().table('execution_events')
                    .select('event_type, payload, created_at')
                    .eq('user_id', user_id).eq('broker', broker)
                    .gte('created_at', cutoff)
                    .order('created_at', desc=False)
                    .limit(2000).execute()).data or []
        except Exception as e:
            logger.warning(f"broker_reconciler: open-set fetch failed for {broker}: {e}")
            return set()

        open_ids: set[str] = set()
        for r in rows:
            p = r.get('payload') or {}
            pid = p.get('broker_pos_id') or p.get('position_id') or p.get('order_id')
            if not pid:
                continue
            et = r.get('event_type')
            if et == 'ORDER_FILLED':
                open_ids.add(pid)
            elif et == 'POSITION_CLOSED':
                open_ids.discard(pid)
        return open_ids
