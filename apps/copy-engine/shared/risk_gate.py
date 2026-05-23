"""
copy-engine — copy-level risk pre-gate (§6 of COPY_TRADING_INFRASTRUCTURE.md).

This is NOT the institutional risk engine — the engine's non-bypassable
12-gate stack still runs inside /api/v1/execute. This gate is a cheaper
pre-filter so we don't waste a broker round-trip on jobs that will
obviously fail, and so a rejection becomes a recorded *decision*
(terminal, never retried) rather than a transient error.

Returns (passed: bool, reason: str). A False result means the job is
terminal-rejected; the reason is journaled and shown to the follower.

All checks are read-only against the control plane. Designed to fail
CLOSED on ambiguity — if we can't prove a copy is safe, we skip it.
"""
from __future__ import annotations
from dataclasses import dataclass

from shared.models import Subscription

# Per-follower safety caps. Deliberately conservative; tune via env later.
MAX_OPEN_COPIES_PER_SYMBOL = 1     # no pyramiding the same symbol/direction
MAX_DAILY_COPIES           = 200   # runaway-leader circuit breaker per follower


@dataclass
class GateContext:
    """Everything the gate needs, pre-fetched by the executor so the gate
    itself stays pure-ish (one optional count query)."""
    broker_connected:  bool
    broker_state:      str            # CONNECTED | TESTING | FAILED | DISABLED | ...
    open_same_symbol:  int            # existing open copies on this symbol+direction
    daily_copy_count:  int
    follower_halted:   bool           # follower kill-switch / HALTED flag


def copy_gate(sub: Subscription, ctx: GateContext, *, symbol: str) -> tuple[bool, str]:
    # 1. Subscription must still be live + copy-enabled.
    if sub.status != 'active':
        return False, f'subscription not active (status={sub.status})'
    if not sub.copy_enabled:
        return False, 'copy disabled on subscription'
    # signal_only mode never produces an order — fan-out should not have
    # created a job, but guard anyway.
    if sub.copy_mode == 'signal_only':
        return False, 'signal_only mode — no execution'

    # 2. Broker must be connected and in a healthy state.
    if not ctx.broker_connected:
        return False, 'follower has no connected broker'
    if ctx.broker_state not in ('CONNECTED', 'TESTING'):
        return False, f'broker state not executable ({ctx.broker_state})'

    # 3. Follower not in kill-switch / HALTED.
    if ctx.follower_halted:
        return False, 'follower account halted (kill-switch active)'

    # 4. Correlation cap — don't stack the same symbol/direction.
    if ctx.open_same_symbol >= MAX_OPEN_COPIES_PER_SYMBOL:
        return False, f'already {ctx.open_same_symbol} open copy on {symbol}'

    # 5. Runaway-leader breaker.
    if ctx.daily_copy_count >= MAX_DAILY_COPIES:
        return False, f'daily copy cap reached ({MAX_DAILY_COPIES})'

    return True, 'ok'
