"""
copy-engine — Copy Allocation Engine (§5 of COPY_TRADING_INFRASTRUCTURE.md).

Three pluggable sizing models, one pure function each. The follower's
strategy_subscriptions.allocation_model selects which runs. Every result
is clamped by min_lot, max_lot_size, the broker volume_step, and rounded
down to a safe lot — never up, so we can't size a follower beyond intent.

Pure + deterministic: no I/O, fully unit-testable.
"""
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Optional


# Conservative default — adapters refine per-pair when they can. Used only
# by the risk_pct model (which needs a $/pip/lot figure).
DEFAULT_PIP_VALUE_USD = 10.0


@dataclass
class AllocationParams:
    fixed_scale:     float = 1.0
    risk_pct:        float = 1.0
    risk_multiplier: float = 1.0
    max_lot_size:    Optional[float] = None
    min_lot:         float = 0.01
    lot_step:        float = 0.01
    notional_cap:    Optional[float] = None   # hard ceiling on lot regardless of model


def pip_size(pair: str) -> float:
    p = pair.upper()
    if 'JPY' in p:        return 0.01
    if p.startswith('XAU'): return 0.10
    if p.startswith('XAG'): return 0.01
    if p.startswith('BTC'): return 1.0
    if p.startswith('ETH'): return 0.10
    return 0.0001


def _clamp(lot: float, p: AllocationParams) -> float:
    """Floor to lot_step, enforce min/max + hard cap. Returns 0.0 when the
    sized lot can't meet the broker minimum (caller marks the job skipped)."""
    if lot <= 0 or not math.isfinite(lot):
        return 0.0
    if p.max_lot_size is not None:
        lot = min(lot, p.max_lot_size)
    if p.notional_cap is not None:
        lot = min(lot, p.notional_cap)
    # Round DOWN to the broker's lot step so we never exceed the sized risk.
    # Add a tiny epsilon before floor: binary float makes 0.20/0.01 = 19.9999…,
    # which would wrongly floor a correctly-sized 0.20 lot down to 0.19.
    step = p.lot_step if p.lot_step > 0 else 0.01
    lot = math.floor(lot / step + 1e-9) * step
    if lot < p.min_lot:
        return 0.0
    # Kill floating dust (0.30000000004 → 0.30).
    return round(lot, 8)


def equity_ratio(*, leader_lot: float, leader_equity: Optional[float],
                 follower_equity: float, p: AllocationParams) -> float:
    """Mirror the leader, scaled by relative account size.
        follower_lot = leader_lot × (follower_eq / leader_eq) × risk_mult
    Falls back to a plain mirror (ratio=1) if leader equity is unknown."""
    if leader_lot <= 0:
        return 0.0
    ratio = 1.0
    if leader_equity and leader_equity > 0:
        ratio = follower_equity / leader_equity
    return _clamp(leader_lot * ratio * p.risk_multiplier, p)


def fixed_ratio(*, leader_lot: float, p: AllocationParams) -> float:
    """Deterministic multiple of the leader's lot. Ignores equity."""
    if leader_lot <= 0:
        return 0.0
    return _clamp(leader_lot * p.fixed_scale, p)


def risk_pct(*, entry: Optional[float], stop_loss: Optional[float],
             follower_equity: float, pip_value: float, pair: str,
             p: AllocationParams) -> float:
    """Size so the SL distance risks exactly risk_pct% of follower equity:
        follower_lot = (follower_eq × risk_pct%) / (sl_pips × pip_value)
    Requires entry + stop_loss; returns 0.0 if either is missing or the
    stop is zero-distance (we will not guess a stop)."""
    if entry is None or stop_loss is None or follower_equity <= 0:
        return 0.0
    sl_pips = abs(entry - stop_loss) / pip_size(pair)
    if sl_pips <= 0:
        return 0.0
    risk_usd = follower_equity * (p.risk_pct / 100.0)
    pv = pip_value if pip_value > 0 else DEFAULT_PIP_VALUE_USD
    return _clamp((risk_usd / (sl_pips * pv)) * p.risk_multiplier, p)


def compute_lot(model: str, *, pair: str, leader_lot: float,
                leader_equity: Optional[float], follower_equity: float,
                entry: Optional[float], stop_loss: Optional[float],
                pip_value: float, p: AllocationParams) -> float:
    """Dispatch to the selected model. Unknown model → 0.0 (job skipped)."""
    if model == 'equity_ratio':
        return equity_ratio(leader_lot=leader_lot, leader_equity=leader_equity,
                            follower_equity=follower_equity, p=p)
    if model == 'fixed_ratio':
        return fixed_ratio(leader_lot=leader_lot, p=p)
    if model == 'risk_pct':
        return risk_pct(entry=entry, stop_loss=stop_loss,
                       follower_equity=follower_equity, pip_value=pip_value,
                       pair=pair, p=p)
    return 0.0
