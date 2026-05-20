"""
Telegram trade notifier — engine-side.

Fires a single "trade opened" message to a user's linked Telegram chat
after a successful order submit. Mirrors the web-side contract in
lib/telegram-notify.ts:

  * Best-effort, never raises. Order execution must never depend on
    Telegram availability.
  * Silent no-op when prerequisites are missing (TELEGRAM_BOT_TOKEN
    unset, user_id missing, profiles.telegram_chat_id null).
  * One attempt with a short timeout — no retry loops, no queue
    illusion. Callers spawn it with `asyncio.create_task(...)` so the
    HTTP response returns before this finishes.

Honest by design: every input here is a real fill detail returned by
the broker adapter — there is no fabricated rationale, no fake
confidence number layered on at the notify step.
"""
from __future__ import annotations
import os
from typing import Optional
import httpx
from loguru import logger

TIMEOUT_S = 4.0


def _bot_token() -> Optional[str]:
    tok = os.environ.get('TELEGRAM_BOT_TOKEN')
    return tok if tok else None


async def _lookup_chat_id(user_id: str) -> Optional[int | str]:
    """Resolve the follower's telegram_chat_id via Supabase service role.
    Returns None on any failure or if the user hasn't linked Telegram."""
    try:
        # Lazy import keeps the rest of the engine free of supabase
        # cold-start cost when notifications aren't used.
        from config import get_settings
        from supabase import create_client
        s = get_settings()
        db = create_client(s.supabase_url, s.supabase_service_role_key)
        r = (
            db.table('profiles')
            .select('telegram_chat_id')
            .eq('id', user_id)
            .single()
            .execute()
        )
        chat = (r.data or {}).get('telegram_chat_id')
        return chat if chat else None
    except Exception as e:
        logger.warning(f"notifier: telegram_chat_id lookup failed for {user_id[:8]}…: {e}")
        return None


def _trade_opened_message(
    broker:        str,
    symbol:        str,
    side:          str,
    qty:           float,
    fill_price:    float,
    sl:            Optional[float],
    tp:            Optional[float],
    slippage_pct:  float,
    testnet:       bool,
) -> str:
    """Compose an honest, fact-only fill summary. No confidence score
    is invented here — the rationale lives on the parent signal row
    and is rendered separately on the execution dashboard."""
    head = '🟢' if side.lower() == 'buy' else '🔴'
    lines = [
        f"{head} <b>Trade opened</b>",
        f"{side.upper()} {symbol}  ·  {broker}{' (testnet)' if testnet else ''}",
        f"Qty: <b>{qty:g}</b>  ·  Fill: <b>{fill_price:.4f}</b>",
    ]
    if sl is not None or tp is not None:
        sl_s = f"{sl:.4f}" if sl is not None else '—'
        tp_s = f"{tp:.4f}" if tp is not None else '—'
        lines.append(f"SL: {sl_s}  ·  TP: {tp_s}")
    if abs(slippage_pct) > 0:
        lines.append(f"Slippage: {slippage_pct * 100:.3f}%")
    return '\n'.join(lines)


def _broker_state_message(broker: str, new_state: str, reason: Optional[str]) -> str:
    """Compose a short, factual broker state-change alert. Honest by
    design — names the broker, the new state, and the engine's actual
    reason string (not an editorialized version)."""
    head = {
        'connected': '🟢',
        'failed':    '🔴',
        'disabled':  '⚪',
    }.get(new_state, '🟡')
    label = {
        'connected': 'Broker connected',
        'failed':    'Broker connection failed',
        'disabled':  'Broker disabled',
    }.get(new_state, f'Broker {new_state}')
    lines = [
        f"{head} <b>{label}</b>",
        f"<b>{broker.upper()}</b>",
    ]
    if reason:
        # Truncate to keep telegram messages compact; full reason is in
        # the dashboard.
        snippet = reason if len(reason) <= 220 else reason[:217] + '…'
        lines.append(snippet)
    return '\n'.join(lines)


async def dispatch_broker_state_change(
    *,
    user_id:   Optional[str],
    broker:    str,
    new_state: str,
    reason:    Optional[str],
) -> None:
    """
    Fire a Telegram alert when a broker connection transitions between
    states (PENDING/CONNECTED/FAILED/DISABLED).

    Called from worker.broker_health and api.brokers — both invoke us
    via asyncio.create_task so we never block the probe or the test
    endpoint's response. Never raises.

    De-duplication of repeated identical states is the caller's
    responsibility (broker_health tracks last-notified state in-process).
    """
    try:
        if not user_id:
            return
        token = _bot_token()
        if not token:
            return
        chat_id = await _lookup_chat_id(user_id)
        if chat_id is None:
            return

        body = {
            'chat_id': chat_id,
            'text':    _broker_state_message(broker, new_state, reason),
            'parse_mode': 'HTML',
            'disable_web_page_preview': True,
        }
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await client.post(
                f'https://api.telegram.org/bot{token}/sendMessage',
                json=body,
            )
            if r.status_code >= 400:
                logger.warning(f"notifier: telegram {r.status_code} for {user_id[:8]}…")
    except Exception as e:
        logger.warning(f"notifier: broker_state_change dispatch failed: {e}")


async def dispatch_trade_opened(
    *,
    user_id:       Optional[str],
    broker:        str,
    symbol:        str,
    side:          str,
    qty:           float,
    fill_price:    float,
    sl:            Optional[float],
    tp:            Optional[float],
    slippage_pct:  float,
    testnet:       bool,
) -> None:
    """Fire a Telegram alert for a successful fill. Never raises."""
    try:
        if not user_id:
            return  # paper-mode / env adapter — no user to notify
        token = _bot_token()
        if not token:
            return
        chat_id = await _lookup_chat_id(user_id)
        if chat_id is None:
            return  # user hasn't linked Telegram; silent no-op

        body = {
            'chat_id': chat_id,
            'text': _trade_opened_message(
                broker, symbol, side, qty, fill_price, sl, tp, slippage_pct, testnet,
            ),
            'parse_mode': 'HTML',
            'disable_web_page_preview': True,
        }
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await client.post(
                f'https://api.telegram.org/bot{token}/sendMessage',
                json=body,
            )
            if r.status_code >= 400:
                logger.warning(f"notifier: Telegram {r.status_code} for {user_id[:8]}…")
    except Exception as e:
        # Honest, contained failure. Order has already filled.
        logger.warning(f"notifier: trade_opened dispatch failed: {e}")
