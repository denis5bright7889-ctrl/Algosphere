"""
notify_discord — fire-and-forget Discord notifications for the
signal-engine (Railway).

One env var per channel; missing env = silent no-op so the absence
of a webhook never breaks the publish path. Failures are logged at
WARNING level only — primary signal/trade/rejection persistence is
NEVER blocked by a Discord post.

The 5 channels owned by the engine (set on Railway, not Vercel):
  DISCORD_WEBHOOK_SIGNALS_FREE_URL        — free-tier signals
  DISCORD_WEBHOOK_SIGNALS_PREMIUM_URL     — premium-tier signals
  DISCORD_WEBHOOK_SIGNALS_WHALES_URL      — whale flows
  DISCORD_WEBHOOK_TRADES_URL              — executed trade fills
  DISCORD_WEBHOOK_REJECTIONS_TRANSPARENCY_URL — risk-gate rejections

All other webhooks (general, education, etc.) live on Vercel and
are used by the web app — DO NOT duplicate them here.
"""
from __future__ import annotations

import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Channel → env-var lookup ─────────────────────────────────────────
_CHANNEL_ENV = {
    "signals_free":    "DISCORD_WEBHOOK_SIGNALS_FREE_URL",
    "signals_premium": "DISCORD_WEBHOOK_SIGNALS_PREMIUM_URL",
    "signals_whales":  "DISCORD_WEBHOOK_SIGNALS_WHALES_URL",
    "trades":          "DISCORD_WEBHOOK_TRADES_URL",
    "rejections":      "DISCORD_WEBHOOK_REJECTIONS_TRANSPARENCY_URL",
}

# Discord embed colours — match lib/notifications/discord.ts.
COLOR_OK       = 0x10B981  # emerald — winning trade, healthy signal
COLOR_WARN     = 0xF59E0B  # amber — caution, rejected for non-critical reason
COLOR_CRITICAL = 0xEF4444  # rose — losing trade, kill switch, hard fail
COLOR_INFO     = 0x60A5FA  # sky — neutral updates
COLOR_AMBER    = 0xF59E0B  # alias


async def _post(channel: str, content: str, embed: Optional[dict[str, Any]] = None) -> bool:
    """
    Best-effort POST to a Discord webhook. Returns True on 2xx, False
    on any failure (including missing env). Errors are logged but
    never raised — caller MUST not depend on this for correctness.
    """
    env_key = _CHANNEL_ENV.get(channel)
    if env_key is None:
        logger.error("notify_discord: unknown channel %r", channel)
        return False
    url = os.getenv(env_key)
    if not url:
        # Silent no-op — channel intentionally unconfigured.
        return False

    payload: dict[str, Any] = {
        "content": (content or "")[:2000],
        "allowed_mentions": {"parse": []},
    }
    if embed is not None:
        payload["embeds"] = [embed]

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(url, json=payload)
            if 200 <= res.status_code < 300:
                return True
            logger.warning(
                "notify_discord[%s] HTTP %d: %s",
                channel, res.status_code, res.text[:200],
            )
            return False
    except Exception as e:
        logger.warning("notify_discord[%s] exception: %s", channel, e)
        return False


# ── Public helpers ───────────────────────────────────────────────────

async def notify_signal(
    tier: str,                                       # 'free' | 'premium' | 'whales'
    symbol: str,
    direction: str,                                  # 'buy' | 'sell'
    entry: float,
    stop_loss: float,
    take_profit_1: float,
    risk_reward: Optional[float],
    confidence: Optional[int],
    regime: Optional[str],
) -> None:
    """Post a new signal to the appropriate tier channel."""
    channel = f"signals_{tier}" if tier in ("free", "premium", "whales") else "signals_free"
    color   = COLOR_OK if direction == "buy" else COLOR_CRITICAL
    arrow   = "🟢 BUY" if direction == "buy" else "🔴 SELL"

    fields = [
        {"name": "Entry", "value": f"`{entry}`",       "inline": True},
        {"name": "SL",    "value": f"`{stop_loss}`",   "inline": True},
        {"name": "TP1",   "value": f"`{take_profit_1}`", "inline": True},
    ]
    if risk_reward is not None: fields.append({"name": "R:R",       "value": f"{risk_reward:.2f}", "inline": True})
    if confidence  is not None: fields.append({"name": "Confidence","value": f"{confidence}/100",  "inline": True})
    if regime:                  fields.append({"name": "Regime",    "value": regime,               "inline": True})

    await _post(
        channel,
        f"{arrow} **{symbol}**",
        embed={
            "title":  f"{symbol} — {arrow}",
            "color":  color,
            "fields": fields,
            "footer": {"text": f"tier: {tier}"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


async def notify_trade(
    symbol: str,
    direction: str,
    qty: float,
    avg_price: float,
    pnl_usd: Optional[float] = None,
    broker: Optional[str] = None,
    is_close: bool = False,
) -> None:
    """Post a trade fill (entry or close)."""
    arrow = "🔵 OPEN" if not is_close else ("🟢 CLOSE" if (pnl_usd or 0) >= 0 else "🔴 CLOSE")
    color = (
        COLOR_INFO if not is_close
        else COLOR_OK if (pnl_usd or 0) >= 0
        else COLOR_CRITICAL
    )
    fields = [
        {"name": "Side",  "value": direction.upper(), "inline": True},
        {"name": "Qty",   "value": f"{qty}",          "inline": True},
        {"name": "Price", "value": f"`{avg_price}`", "inline": True},
    ]
    if pnl_usd is not None:
        sign = "+" if pnl_usd >= 0 else ""
        fields.append({"name": "P&L", "value": f"{sign}${pnl_usd:.2f}", "inline": True})
    if broker:
        fields.append({"name": "Broker", "value": broker, "inline": True})

    await _post(
        "trades",
        f"{arrow} **{symbol}**",
        embed={
            "title":  f"{symbol} — {arrow}",
            "color":  color,
            "fields": fields,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


async def notify_rejection(
    symbol: str,
    reason: str,
    gate: str,                          # which risk gate fired
    proposed_direction: Optional[str] = None,
    proposed_entry: Optional[float] = None,
) -> None:
    """
    Post a risk-gate rejection (transparency channel).

    Goal: show prospective users / current users that the engine
    actively REFUSES trades that don't pass the gates — this is the
    "we don't take every signal" social proof.
    """
    fields = [
        {"name": "Gate",   "value": gate,   "inline": True},
        {"name": "Reason", "value": reason, "inline": False},
    ]
    if proposed_direction:
        fields.append({"name": "Proposed direction", "value": proposed_direction.upper(), "inline": True})
    if proposed_entry is not None:
        fields.append({"name": "Proposed entry", "value": f"`{proposed_entry}`", "inline": True})

    await _post(
        "rejections",
        f"⚠ **{symbol}** — risk gate rejected",
        embed={
            "title":  f"{symbol} — rejected",
            "color":  COLOR_WARN,
            "fields": fields,
            "footer": {"text": "Transparency — not every signal becomes a trade."},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


# Fire-and-forget wrapper: schedules the coroutine without blocking.
# Use this at call sites in synchronous paths where awaiting would
# add latency to the primary flow.
def fire(coro: "asyncio.Future[Any] | Any") -> None:
    """
    Schedule a coroutine on the running event loop without awaiting.
    The caller MUST be inside an active event loop (e.g. the scan
    worker). Outside one, this no-ops.
    """
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        # No running loop — drop the notification (sync caller).
        try:
            coro.close()  # type: ignore[union-attr]
        except Exception:
            pass
