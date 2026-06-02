"""
Execution-event emitter — shared by every live broker adapter.

WHY THIS EXISTS
The journal auto-detection trigger (migration 20240101000029) creates
a journal_entries row on every ORDER_FILLED insert into
execution_events, and updates the matching row on POSITION_CLOSED.
The trigger has worked correctly since day one.

THE BUG IT FIXES
Until this module, ONLY paper_adapter.py wrote to execution_events.
Every live adapter (mt5, mt5_bridge, binance, bybit, okx, oanda,
tradovate) submitted orders to the broker and returned the result to
the caller WITHOUT recording the fill. So real broker trades never
produced journal entries.

USAGE
After every successful fill:

    from risk.adapters.execution_event_emit import emit_execution_event
    emit_execution_event(
        user_id=ctx.user_id, broker='mt5', event_type='ORDER_FILLED',
        payload={
            'order_id':      str(result.order),
            'symbol':        req.symbol,
            'side':          req.side.value,
            'order_type':    req.order_type.value,
            'requested_qty': req.quantity,
            'filled_qty':    float(result.volume),
            'avg_fill_price': avg_price,
            'slippage_pct':  slippage,
            'status':        'FILLED',
            'sl':            req.stop_loss,
            'tp':            req.take_profit,
        },
    )

CONTRACT
  • Non-raising. A write failure NEVER propagates back to submit_order.
  • Reads service-role Supabase via config.get_settings().
  • No credentials, no API keys ever go into payload — the caller is
    responsible for sanitisation.

The matching `mirror_to_system_log` helper also writes a sanitised
copy to system_event_log so the diagnostics endpoint and the future
Discord publisher see the same events from a single source.
"""
from __future__ import annotations

from typing import Any, Optional
from loguru import logger
from supabase import create_client, Client

from config import get_settings
import system_events


_db: Optional[Client] = None


def _client() -> Optional[Client]:
    global _db
    if _db is not None:
        return _db
    try:
        s = get_settings()
        if not s.has_supabase:
            return None
        _db = create_client(s.supabase_url, s.supabase_service_role_key)
        return _db
    except Exception as e:
        logger.debug(f"execution_event_emit: client init failed: {e}")
        return None


def emit_execution_event(
    *,
    user_id: str,
    broker: str,
    event_type: str,
    payload: dict[str, Any],
    mirror: bool = True,
) -> None:
    """Insert into public.execution_events. The journal auto-detection
    trigger fires on ORDER_FILLED / POSITION_CLOSED and writes the
    matching journal_entries row.

    Setting mirror=False suppresses the system_event_log copy — useful
    for high-volume PAPER_INIT-style events. Defaults to True so the
    diagnostics endpoint always sees a copy.
    """
    db = _client()
    if db is None:
        return
    try:
        db.table('execution_events').insert({
            'user_id':    user_id,
            'event_type': event_type,
            'broker':     broker,
            'payload':    payload,
        }).execute()
    except Exception as e:
        # Critical to log loudly — a missed execution_events write means
        # the journal will be missing this trade. The operator MUST see
        # this in the Railway logs.
        logger.error(
            f"execution_event_emit: insert failed broker={broker} "
            f"event={event_type} symbol={payload.get('symbol')} err={e}",
        )

    if not mirror:
        return

    # Mirror a sanitised copy to system_event_log so the diagnostics
    # endpoint surfaces the trade lifecycle without scanning
    # execution_events directly. Map event_type → surface.
    surface_for = {
        'ORDER_FILLED':    'trade_open',
        'ORDER_REJECTED':  'trade_failed',
        'POSITION_CLOSED': 'trade_close',
        'SL_HIT':          'sl_hit',
        'TP_HIT':          'tp_hit',
    }
    surface = surface_for.get(event_type)
    if surface is None:
        return
    summary = {
        'broker':     broker,
        'symbol':     payload.get('symbol'),
        'side':       payload.get('side'),
        'order_id':   payload.get('order_id') or payload.get('position_id'),
        'avg_price':  payload.get('avg_fill_price') or payload.get('exit'),
        'qty':        payload.get('filled_qty') or payload.get('qty'),
        'pnl':        payload.get('realized_pnl'),
        'reason':     payload.get('reason'),
    }
    # Drop None values so the JSON stays clean.
    summary = {k: v for k, v in summary.items() if v is not None}
    system_events.emit(
        surface,
        payload=summary,
        status='sent' if event_type != 'ORDER_REJECTED' else 'failed',
        error_class=None if event_type != 'ORDER_REJECTED' else 'broker_reject',
    )
