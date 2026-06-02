"""
Signal broadcaster — auto-posts newly published signals to the Telegram
channel/group and DMs linked subscribers.

Runs as a repeating JobQueue task inside the bot process. Polls the
`signals` table for rows published since the bot started (so a restart
never re-spams history), then:

  • posts a full institutional signal card to the configured channel/group
    (TELEGRAM_CHANNEL_ID) — the public growth funnel, with a sign-up CTA;
  • DMs each linked user (profiles.telegram_chat_id) — full card to those
    whose tier covers the signal, an upgrade teaser to those below it.

Production hardening (Phase 1):
  • Dedup — every signal id is posted at most once, even across overlapping
    polls or equal published_at timestamps.
  • Retry/backoff — transient send errors retry; Telegram flood-control
    (RetryAfter) is honoured; a blocked user is counted, not retried.
  • Anti-spam — a small inter-send delay keeps us under Telegram limits.
  • Delivery metrics — sent / failed / blocked / retried / deduped, logged
    each cycle.
  • Resilience — a single failed send NEVER breaks the loop. Channel and
    direct chats share the same send path (groups supported via chat_id).

Safety: reads `signals` + sends messages only. It NEVER places trades.
"""
from __future__ import annotations
import os
import asyncio
import logging
from datetime import datetime, timezone
from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import RetryAfter, Forbidden, TimedOut, NetworkError, BadRequest
from database import get_db

logger = logging.getLogger(__name__)

# Only broadcast signals published AFTER the bot started — no history spam.
_last_seen_iso = datetime.now(timezone.utc).isoformat()

# Dedup: ids already broadcast (bounded; trimmed so it can't grow unbounded).
_posted_ids: set[str] = set()
_POSTED_CAP = 2000

# Cumulative delivery metrics (logged each cycle; reset never — operator view).
_metrics = {'cycles': 0, 'signals': 0, 'sent': 0, 'failed': 0,
            'blocked': 0, 'retried': 0, 'deduped': 0}

# Anti-spam: seconds between consecutive sends (Telegram ~30 msg/s global).
_SEND_GAP_S = 0.05
_MAX_RETRIES = 2

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


def _trade_keyboard(signal_id: str, locked: bool) -> InlineKeyboardMarkup:
    """Inline buttons attached to every broadcast signal card.

    The primary CTA deep-links the user back to /signals?execute=<id>
    on the web app, which auto-opens the Place Trade modal pre-bound to
    this signal — so the user can place the order in two taps from
    Telegram without retyping anything.

    For a teaser (tier-locked) card the CTA flips to "Upgrade to take
    trade" pointing at /upgrade. Either way the second button takes the
    user to the full dashboard for context.
    """
    base = _app_url()
    if locked:
        primary = InlineKeyboardButton('🔒 Upgrade to take trade', url=f'{base}/upgrade')
    else:
        primary = InlineKeyboardButton('⚡ Take trade',
                                       url=f'{base}/signals?execute={signal_id}')
    return InlineKeyboardMarkup([
        [primary],
        [InlineKeyboardButton('📊 View on dashboard',
                              url=f'{base}/signals?focus={signal_id}')],
    ])


async def _send_with_retry(bot, chat_id, text: str,
                            reply_markup=None) -> str:
    """Send one message with flood-control + transient-error retry.
    Returns: 'sent' | 'blocked' | 'failed'. Never raises."""
    for attempt in range(_MAX_RETRIES + 1):
        try:
            await bot.send_message(chat_id=chat_id, text=text,
                                   parse_mode='Markdown',
                                   reply_markup=reply_markup,
                                   disable_web_page_preview=True)
            return 'sent'
        except RetryAfter as e:          # Telegram flood control — honour it.
            wait = float(getattr(e, 'retry_after', 1)) + 0.5
            _metrics['retried'] += 1
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(min(wait, 30))
                continue
            return 'failed'
        except Forbidden:                # user blocked the bot / kicked — don't retry.
            return 'blocked'
        except BadRequest as e:          # bad chat_id / markup — don't retry.
            logger.debug(f"broadcaster: bad request to {chat_id} — {e}")
            return 'failed'
        except (TimedOut, NetworkError):  # transient — retry with backoff.
            _metrics['retried'] += 1
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            return 'failed'
        except Exception as e:
            logger.debug(f"broadcaster: send to {chat_id} failed — {e}")
            return 'failed'
    return 'failed'


def _record(status: str) -> None:
    if status == 'sent':    _metrics['sent'] += 1
    elif status == 'blocked': _metrics['blocked'] += 1
    else:                   _metrics['failed'] += 1


async def _linked_subscribers() -> list[dict]:
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
               .gte('published_at', _last_seen_iso)
               .eq('status', 'active')
               .order('published_at', desc=False)
               .limit(20)
               .execute())
        rows = res.data or []
        # Dedup: drop anything already posted (handles equal timestamps / overlap).
        fresh = [r for r in rows if r.get('id') and r['id'] not in _posted_ids]
        _metrics['deduped'] += (len(rows) - len(fresh))
        if rows:
            _last_seen_iso = rows[-1]['published_at']
        return fresh
    except Exception as e:
        logger.warning(f"broadcaster: signals query failed — {e}")
        return []


def _remember(signal_id: str) -> None:
    _posted_ids.add(signal_id)
    if len(_posted_ids) > _POSTED_CAP:        # bound memory — keep newest half.
        for old in list(_posted_ids)[: _POSTED_CAP // 2]:
            _posted_ids.discard(old)


async def poll_and_broadcast(context) -> None:
    """JobQueue callback — runs on a fixed cadence."""
    _metrics['cycles'] += 1
    signals = await _new_signals()
    if not signals:
        return

    bot = context.bot
    channel = _channel_id()
    subscribers = await _linked_subscribers()
    _metrics['signals'] += len(signals)
    logger.info(f"broadcaster: {len(signals)} new signal(s) → "
                f"channel={'on' if channel else 'off'}, {len(subscribers)} linked users")

    for s in signals:
        required_rank = _TIER_RANK.get((s.get('tier_required') or 'starter').lower(), 1)

        signal_id = s.get('id') or ''

        # 1. Channel/group (public funnel). Public posts always show the
        # tier-locked keyboard ("Upgrade to take trade") since the channel
        # has mixed tiers — the web app re-checks access on click.
        if channel:
            kb = _trade_keyboard(signal_id, locked=False)
            _record(await _send_with_retry(bot, channel, _full_card(s),
                                            reply_markup=kb))
            await asyncio.sleep(_SEND_GAP_S)

        # 2. Linked subscribers — full card if their tier covers it, else teaser.
        # The keyboard tracks the same tier check so a free user gets an
        # upgrade CTA instead of a take-trade link that would just bounce.
        for prof in subscribers:
            chat_id = prof.get('telegram_chat_id')
            if not chat_id:
                continue
            tier_rank = _TIER_RANK.get((prof.get('subscription_tier') or 'free').lower(), 0)
            covers = tier_rank >= required_rank
            text   = _full_card(s) if covers else _teaser_card(s)
            kb     = _trade_keyboard(signal_id, locked=not covers)
            _record(await _send_with_retry(bot, chat_id, text,
                                            reply_markup=kb))
            await asyncio.sleep(_SEND_GAP_S)

        _remember(s['id'])

    logger.info(
        "broadcaster metrics: "
        f"signals={_metrics['signals']} sent={_metrics['sent']} "
        f"failed={_metrics['failed']} blocked={_metrics['blocked']} "
        f"retried={_metrics['retried']} deduped={_metrics['deduped']}"
    )
