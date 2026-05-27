"""
Signal broadcaster — auto-posts newly published signals to the Telegram
channel and DMs linked subscribers.

Runs as a repeating JobQueue task inside the bot process. Polls the
`signals` table for rows published since the bot started (so a restart
never re-spams history), formats an institutional signal card, and:

  • posts it to the configured channel (TELEGRAM_CHANNEL_ID) — the public
    growth funnel, with a sign-up CTA;
  • DMs each linked user (profiles.telegram_chat_id) — full card to those
    whose tier covers the signal, an upgrade teaser to those below it.

Safe + best-effort: a single failed send (user blocked the bot, channel
not configured, …) is logged and skipped; it never breaks the loop, and
it NEVER places trades (this only reads `signals` and sends messages).
"""
from __future__ import annotations
import os
import logging
from datetime import datetime, timezone
from database import get_db

logger = logging.getLogger(__name__)

# Only broadcast signals published AFTER the bot started — no history spam.
_last_seen_iso = datetime.now(timezone.utc).isoformat()

_TIER_RANK = {'free': 0, 'starter': 1, 'premium': 2, 'vip': 3}


def _app_url() -> str:
    return os.environ.get('APP_URL', 'https://algospherequant.com')


def _channel_id() -> str | None:
    cid = os.environ.get('TELEGRAM_CHANNEL_ID', '').strip()
    return cid or None


def _fmt_num(v) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return '—'
    if f >= 1000:  return f'{f:,.2f}'
    if f >= 1:     return f'{f:.2f}'
    return f'{f:.5f}'


def _full_card(s: dict) -> str:
    arrow = '🟢 BUY' if s.get('direction') == 'buy' else '🔴 SELL'
    conf = s.get('confidence_score')
    conf_line = f"\n*Confidence:* {conf}/100" if conf is not None else ''
    regime = s.get('regime')
    regime_line = f"\n*Regime:* {regime}" if regime else ''
    return (
        f"📊 *{s.get('pair')}*  {arrow}\n"
        f"\n*Entry:* `{_fmt_num(s.get('entry_price'))}`"
        f"\n*Stop:* `{_fmt_num(s.get('stop_loss'))}`"
        f"\n*TP1:* `{_fmt_num(s.get('take_profit_1'))}`"
        f"\n*TP2:* `{_fmt_num(s.get('take_profit_2'))}`"
        f"\n*TP3:* `{_fmt_num(s.get('take_profit_3'))}`"
        f"\n*R:R:* `{_fmt_num(s.get('risk_reward'))}`"
        f"{conf_line}{regime_line}"
        f"\n\n_AlgoSphere Quant — institutional signal intelligence._"
        f"\nFull dashboard → {_app_url()}"
    )


def _teaser_card(s: dict) -> str:
    arrow = '🟢 BUY' if s.get('direction') == 'buy' else '🔴 SELL'
    conf = s.get('confidence_score')
    conf_line = f"  ·  Confidence {conf}/100" if conf is not None else ''
    return (
        f"📊 *{s.get('pair')}*  {arrow}{conf_line}\n"
        f"🔒 Entry, stop & targets are members-only.\n"
        f"Join free → {_app_url()}"
    )


async def _linked_subscribers() -> list[dict]:
    """Profiles that linked Telegram. Best-effort; [] on error."""
    try:
        res = (get_db().table('profiles')
               .select('telegram_chat_id, subscription_tier')
               .not_.is_('telegram_chat_id', 'null')
               .execute())
        return res.data or []
    except Exception as e:
        logger.warning(f"broadcaster: subscriber query failed — {e}")
        return []


async def _new_signals() -> list[dict]:
    global _last_seen_iso
    try:
        res = (get_db().table('signals')
               .select('id,pair,direction,entry_price,stop_loss,take_profit_1,'
                       'take_profit_2,take_profit_3,risk_reward,confidence_score,'
                       'regime,tier_required,status,published_at')
               .gt('published_at', _last_seen_iso)
               .eq('status', 'active')
               .order('published_at', desc=False)
               .limit(20)
               .execute())
        rows = res.data or []
        if rows:
            _last_seen_iso = rows[-1]['published_at']
        return rows
    except Exception as e:
        logger.warning(f"broadcaster: signals query failed — {e}")
        return []


async def poll_and_broadcast(context) -> None:
    """JobQueue callback — runs on a fixed cadence."""
    signals = await _new_signals()
    if not signals:
        return

    bot = context.bot
    channel = _channel_id()
    subscribers = await _linked_subscribers()
    logger.info(f"broadcaster: {len(signals)} new signal(s) → "
                f"channel={'on' if channel else 'off'}, {len(subscribers)} linked users")

    for s in signals:
        required_rank = _TIER_RANK.get((s.get('tier_required') or 'starter').lower(), 1)

        # 1. Channel (public funnel).
        if channel:
            try:
                await bot.send_message(chat_id=channel, text=_full_card(s), parse_mode='Markdown')
            except Exception as e:
                logger.warning(f"broadcaster: channel post failed for {s.get('pair')} — {e}")

        # 2. Linked subscribers — full card if their tier covers it, else teaser.
        for prof in subscribers:
            chat_id = prof.get('telegram_chat_id')
            if not chat_id:
                continue
            tier_rank = _TIER_RANK.get((prof.get('subscription_tier') or 'free').lower(), 0)
            text = _full_card(s) if tier_rank >= required_rank else _teaser_card(s)
            try:
                await bot.send_message(chat_id=chat_id, text=text, parse_mode='Markdown')
            except Exception as e:
                # Most common: user blocked the bot — skip, never break the loop.
                logger.debug(f"broadcaster: DM to {chat_id} failed — {e}")
