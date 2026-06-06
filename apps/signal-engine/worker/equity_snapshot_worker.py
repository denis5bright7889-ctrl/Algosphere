"""
Equity Snapshot Worker (V4.1) — the broker-truth data layer.

Polls every connected broker and persists REAL account + position state to
broker_account_snapshots / broker_position_snapshots / equity_timeseries so any
dashboard/AI/analytics/risk engine can reconstruct account state at any past
timestamp. Broker is the source of truth — never estimates, never UI cache.

Reuses the existing adapter layer (risk/adapters/factory + risk/broker_adapter):
  • get_balance() / get_equity()  — sync (run in a thread)
  • get_positions()              — async → Position{symbol,side,qty,avg_entry,
                                    current_price,unrealized_pnl,margin_used,
                                    broker_pos_id}
Derived honestly from positions: used_margin = Σ margin_used, open_pnl =
Σ unrealized_pnl, free_margin = equity − used_margin, margin_level =
equity/used_margin. leverage / currency are NOT in the adapter interface →
stored NULL (not fabricated).

Phase-3 diff engine: emits BALANCE_CHANGED / EQUITY_CHANGED /
POSITION_COUNT_CHANGED only when values MATERIALLY change vs the prior snapshot.

Safety: READ-ONLY on brokers; non-raising per connection; heartbeats every
cycle. DORMANT by default (equity_snapshot_enabled) — and the inserts no-op
gracefully if the migration (20240101000073) hasn't been applied yet.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
from risk.adapters.factory import (
    get_adapter_for_user, BrokerDisabled, BrokerNotConnected, BrokerDecryptError,
)
import system_events as obs


class EquitySnapshotWorker:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._db: Optional[Client] = None

    def db(self) -> Client:
        if self._db is None:
            self._db = create_client(self.settings.supabase_url, self.settings.supabase_service_role_key)
        return self._db

    async def snapshot_all(self) -> None:
        obs.heartbeat('equity_snapshot_worker', status='live')
        if not self.settings.has_supabase:
            return
        try:
            rows = (self.db().table('broker_connections')
                    .select('id, user_id, broker, account_id, status')
                    .eq('status', 'connected').execute()).data or []
        except Exception as e:
            obs.health_alert('equity_snapshot_worker', f'connections fetch failed: {str(e)[:160]}')
            return

        ok = 0
        for c in rows:
            try:
                if await self._snapshot_one(c):
                    ok += 1
            except Exception as e:
                logger.warning(f"equity_snapshot: {c.get('broker')}/{str(c.get('user_id'))[:8]} raised: {e!r}")
        logger.info(f"equity_snapshot cycle: {ok}/{len(rows)} accounts snapshotted")

    async def _snapshot_one(self, conn: dict) -> bool:
        user_id = conn['user_id']; broker = conn['broker']; conn_id = conn['id']
        try:
            adapter = await get_adapter_for_user(self.db(), user_id, broker)
        except BrokerDisabled:
            return False
        except (BrokerNotConnected, BrokerDecryptError) as e:
            obs.health_alert('equity_snapshot_worker', f'{broker}/{str(user_id)[:8]} adapter: {str(e)[:140]}')
            return False

        # Sync broker reads off the event loop; positions are async.
        balance = await asyncio.to_thread(adapter.get_balance)
        equity  = await asyncio.to_thread(adapter.get_equity)
        positions = await adapter.get_positions()

        used_margin = sum(float(getattr(p, 'margin_used', 0) or 0) for p in positions)
        open_pnl    = sum(float(getattr(p, 'unrealized_pnl', 0) or 0) for p in positions)
        open_count  = len(positions)
        free_margin  = (equity - used_margin) if equity is not None else None
        margin_level = (equity / used_margin * 100.0) if (equity and used_margin > 0) else None

        now_iso = datetime.now(timezone.utc).isoformat()

        # ── Diff vs prior account snapshot (Phase 3) ─────────────────────────
        prev = self._last_account(conn_id)
        self._emit_diffs(broker, conn_id, prev, balance, equity, open_count)

        # ── Persist account snapshot ─────────────────────────────────────────
        self._insert('broker_account_snapshots', {
            'broker_connection_id': conn_id, 'user_id': user_id, 'broker_name': broker,
            'account_id': conn.get('account_id'), 'ts': now_iso,
            'balance': _num(balance), 'equity': _num(equity),
            'free_margin': _num(free_margin), 'used_margin': _num(used_margin),
            'margin_level': _num(margin_level), 'leverage': None, 'currency': None,
            'open_positions': open_count, 'source': 'broker_poll',
        })

        # ── Persist position snapshots ───────────────────────────────────────
        for p in positions:
            self._insert('broker_position_snapshots', {
                'broker_connection_id': conn_id, 'user_id': user_id,
                'position_id': getattr(p, 'broker_pos_id', '') or '',
                'symbol': p.symbol, 'side': p.side, 'volume': _num(p.qty),
                'entry_price': _num(p.avg_entry), 'current_price': _num(p.current_price),
                'stop_loss': None, 'take_profit': None,
                'unrealized_pnl': _num(p.unrealized_pnl), 'ts': now_iso,
            })

        # ── Persist equity timeseries (with drawdown vs running peak) ─────────
        peak = self._peak_equity(conn_id)
        eqv = _num(equity)
        drawdown = None
        if eqv is not None:
            peak = max(peak or eqv, eqv)
            drawdown = round((peak - eqv) / peak, 6) if peak and peak > 0 else 0.0
        self._insert('equity_timeseries', {
            'broker_connection_id': conn_id, 'user_id': user_id, 'ts': now_iso,
            'balance': _num(balance), 'equity': eqv, 'drawdown': drawdown,
            'open_pnl': _num(open_pnl), 'closed_pnl': None,
        })
        return True

    # ── helpers ──────────────────────────────────────────────────────────────

    def _last_account(self, conn_id: str) -> Optional[dict]:
        try:
            r = (self.db().table('broker_account_snapshots')
                 .select('balance, equity, open_positions')
                 .eq('broker_connection_id', conn_id)
                 .order('ts', desc=True).limit(1).execute()).data or []
            return r[0] if r else None
        except Exception:
            return None   # table may not exist yet (migration not applied) — silent

    def _peak_equity(self, conn_id: str) -> Optional[float]:
        try:
            r = (self.db().table('equity_timeseries').select('equity')
                 .eq('broker_connection_id', conn_id)
                 .order('equity', desc=True).limit(1).execute()).data or []
            return float(r[0]['equity']) if r and r[0].get('equity') is not None else None
        except Exception:
            return None

    def _insert(self, table: str, row: dict) -> None:
        try:
            self.db().table(table).insert(row).execute()
        except Exception as e:
            # Most likely the migration (20240101000073) isn't applied yet.
            logger.warning(f"equity_snapshot: insert {table} failed (migration applied?): {str(e)[:160]}")

    def _emit_diffs(self, broker, conn_id, prev, balance, equity, open_count) -> None:
        if not prev:
            return
        try:
            pb, pe, pc = prev.get('balance'), prev.get('equity'), prev.get('open_positions')
            if balance is not None and pb is not None and float(balance) != float(pb):
                obs.emit('engine_event', payload={'event': 'BALANCE_CHANGED', 'broker': broker,
                         'connection_id': conn_id, 'from': float(pb), 'to': float(balance)})
            if equity is not None and pe is not None and abs(float(equity) - float(pe)) >= 0.01:
                obs.emit('engine_event', payload={'event': 'EQUITY_CHANGED', 'broker': broker,
                         'connection_id': conn_id, 'from': float(pe), 'to': float(equity)})
            if pc is not None and int(open_count) != int(pc):
                obs.emit('engine_event', payload={'event': 'POSITION_COUNT_CHANGED', 'broker': broker,
                         'connection_id': conn_id, 'from': int(pc), 'to': int(open_count)})
        except Exception:
            pass


def _num(v) -> Optional[float]:
    try:
        return round(float(v), 6) if v is not None else None
    except (TypeError, ValueError):
        return None
