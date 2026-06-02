"""
notify_automation — fire content-pipeline events from the signal-engine
to the Vercel web app's /api/automation/events endpoint.

The web app maps incoming events to growth_automation_rules and creates
draft / scheduled / published content_items. Everything here is
fire-and-forget — a failed POST must never break the publish path.

Env (Railway):
  AUTOMATION_INGEST_URL     — full URL to /api/automation/events
                              (defaults to https://algospherequant.com/api/automation/events)
  AUTOMATION_INGEST_SECRET  — bearer token the web endpoint validates.
                              MUST match the value set in Vercel.
"""
from __future__ import annotations

import os
import asyncio
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_URL = 'https://algospherequant.com/api/automation/events'


async def _post_event(
    event_type: str,
    payload: dict[str, Any],
    source: str = 'signal-engine',
) -> bool:
    """
    POST one event to the web automation endpoint.

    Returns True on 2xx, False otherwise. Errors are logged but
    NEVER raised — caller is signal-engine code that must keep
    running regardless.
    """
    url    = os.getenv('AUTOMATION_INGEST_URL', DEFAULT_URL)
    secret = os.getenv('AUTOMATION_INGEST_SECRET')
    if not secret:
        # Intentional silent skip — env not configured for this deploy.
        return False

    body = {
        'event_type': event_type,
        'payload':    payload,
        'source':     source,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                url,
                json=body,
                headers={'Authorization': f'Bearer {secret}'},
            )
            if 200 <= res.status_code < 300:
                return True
            logger.warning(
                'notify_automation[%s] HTTP %d: %s',
                event_type, res.status_code, res.text[:200],
            )
            return False
    except Exception as e:
        logger.warning('notify_automation[%s] exception: %s', event_type, e)
        return False


# ── Public helpers — semantic names so call-sites read clean ───────

async def emit_signal_published(
    symbol: str,
    direction: str,
    entry: float,
    stop_loss: float,
    take_profit_1: float,
    take_profit_2: Optional[float],
    take_profit_3: Optional[float],
    risk_reward: Optional[float],
    confidence_score: Optional[int],
    confidence_tier: Optional[str],
    regime: Optional[str],
    strategy_id: Optional[str] = None,
    signal_id: Optional[str] = None,
    timeframe: Optional[str] = None,
) -> None:
    """
    Fire a signal.published event. Payload shape matches what the
    Strategy of the Week generator expects (strategy + backtest + grade
    nested), so the matching rule's generator can produce a draft
    immediately.
    """
    payload: dict[str, Any] = {
        # Top-level fields the rule predicate reads (min_quality, etc.)
        'min_quality':       confidence_score or 0,
        # Verbatim fields for downstream rendering
        'symbol':            symbol,
        'direction':         direction,
        'entry':             entry,
        'stop_loss':         stop_loss,
        'take_profit_1':     take_profit_1,
        'take_profit_2':     take_profit_2,
        'take_profit_3':     take_profit_3,
        'risk_reward':       risk_reward,
        'confidence_score':  confidence_score,
        'confidence_tier':   confidence_tier,
        'regime':            regime,
        'strategy_id':       strategy_id,
        'signal_id':         signal_id,
        'timeframe':         timeframe,
    }
    await _post_event('signal.published', payload)


async def emit_signal_outcome(
    kind: str,                    # 'tp_hit' | 'sl_hit' | 'expired'
    symbol: str,
    direction: str,
    entry: float,
    exit_price: float,
    pips_gained: Optional[float],
    pnl_usd: Optional[float],
    strategy_id: Optional[str] = None,
    signal_id: Optional[str] = None,
) -> None:
    """Fire signal.tp_hit / signal.sl_hit."""
    payload: dict[str, Any] = {
        'symbol':      symbol,
        'direction':   direction,
        'entry':       entry,
        'exit':        exit_price,
        'pips_gained': pips_gained,
        'pnl_usd':     pnl_usd,
        'strategy_id': strategy_id,
        'signal_id':   signal_id,
    }
    event_type = f'signal.{kind}'
    await _post_event(event_type, payload)


async def emit_trade_event(
    kind: str,                    # 'opened' | 'closed'
    symbol: str,
    direction: str,
    qty: float,
    price: float,
    pnl_usd: Optional[float] = None,
    broker: Optional[str] = None,
    trade_id: Optional[str] = None,
) -> None:
    """Fire trade.opened / trade.closed."""
    payload: dict[str, Any] = {
        'symbol':    symbol,
        'direction': direction,
        'qty':       qty,
        'price':     price,
        'pnl_usd':   pnl_usd,
        'broker':    broker,
        'trade_id':  trade_id,
    }
    await _post_event(f'trade.{kind}', payload)


# Fire-and-forget — same pattern as notify_discord.fire().
def fire(coro: 'asyncio.Future[Any] | Any') -> None:
    """
    Schedule a coroutine on the running loop without awaiting.
    Caller MUST be inside an event loop (the scan worker is).
    Outside one, this no-ops cleanly.
    """
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        try:
            coro.close()  # type: ignore[union-attr]
        except Exception:
            pass
