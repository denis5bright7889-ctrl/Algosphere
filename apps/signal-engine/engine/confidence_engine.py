"""
AlgoSphere Institutional 9-Factor Confidence Engine
Produces a 0–100 confidence score with full audit breakdown.
Each factor is scored independently and combined with calibrated weights.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional
from engine.feature_engineer import EngineFeatures
from engine.regime_engine import RegimeResult, regime_quality_score
from engine.signal_engine import SignalProposal, Direction


Tier = Literal['blocked', 'normal', 'aggressive', 'exceptional']


@dataclass
class ConfidenceBreakdown:
    ema_alignment: float        # 0–15 pts — all EMAs pointing same way
    ema_separation: float       # 0–10 pts — EMAs well spaced
    price_vs_ema200: float      # 0–10 pts — price on correct side of EMA200
    atr_percentile: float       # 0–10 pts — adequate but not extreme volatility
    rsi_momentum: float         # 0–15 pts — RSI in ideal zone
    macd_alignment: float       # 0–15 pts — MACD histogram matches direction
    session_quality: float      # 0–10 pts — premium trading session
    regime_quality: float       # 0–10 pts — regime favours strategy type
    spread_quality: float       # 0–5  pts  — spread within norms
    total: float
    raw_100: float              # total / max_total * 100

    FACTOR_WEIGHTS: dict = field(default_factory=lambda: {
        'ema_alignment':    15,
        'ema_separation':   10,
        'price_vs_ema200':  10,
        'atr_percentile':   10,
        'rsi_momentum':     15,
        'macd_alignment':   15,
        'session_quality':  10,
        'regime_quality':   10,
        'spread_quality':    5,
    })


@dataclass
class ConfidenceResult:
    score: int               # 0–100 (integer for clean display)
    tier: Tier
    breakdown: ConfidenceBreakdown
    should_publish: bool
    block_reason: Optional[str] = None


MAX_SCORE = 100.0


def score_confidence(
    features: EngineFeatures,
    regime: RegimeResult,
    proposal: SignalProposal,
    spread_pips: float = 2.0,
    avg_spread_pips: float = 2.0,
) -> ConfidenceResult:
    """
    Computes 9-factor institutional confidence score.
    """
    d = proposal.direction

    # 1. EMA Alignment (0–15)
    if (d == 'buy' and features.trend_aligned_bull) or (d == 'sell' and features.trend_aligned_bear):
        ema_align = 15.0
    elif _partial_ema_alignment(features, d):
        ema_align = 9.0
    else:
        ema_align = 3.0

    # 2. EMA Separation (0–10) — measures trend maturity
    sep_abs = abs(features.ema_separation)
    ema_sep = min(sep_abs / 3.0, 1.0) * 10.0

    # 3. Price vs EMA200 (0–10)
    pve = features.price_vs_ema200
    if (d == 'buy' and pve > 0.5) or (d == 'sell' and pve < -0.5):
        price_ema200 = 10.0
    elif (d == 'buy' and pve > 0) or (d == 'sell' and pve < 0):
        price_ema200 = 6.0
    else:
        price_ema200 = 1.0

    # 4. ATR Percentile (0–10) — want 30–70th percentile
    atr_p = features.atr_percentile
    if 30 <= atr_p <= 70:
        atr_score = 10.0
    elif 20 <= atr_p <= 80:
        atr_score = 7.0
    elif atr_p < 10:
        atr_score = 2.0   # dead market
    else:
        atr_score = 4.0

    # 5. RSI Momentum (0–15) — avoid extremes, want directional but not overbought
    rsi = features.rsi14
    if d == 'buy':
        if 45 <= rsi <= 60:  rsi_score = 15.0
        elif 40 <= rsi <= 65: rsi_score = 11.0
        elif 35 <= rsi <= 70: rsi_score = 7.0
        else:                 rsi_score = 2.0
    else:
        if 40 <= rsi <= 55:  rsi_score = 15.0
        elif 35 <= rsi <= 60: rsi_score = 11.0
        elif 30 <= rsi <= 65: rsi_score = 7.0
        else:                 rsi_score = 2.0

    # 6. MACD Alignment (0–15) — histogram matches direction
    hist = features.macd_histogram
    if (d == 'buy' and hist > 0) or (d == 'sell' and hist < 0):
        macd_score = 15.0 * min(abs(hist) / (features.atr14 * 0.1 + 1e-10), 1.0)
        macd_score = max(macd_score, 8.0)
    else:
        macd_score = 1.0

    # 7. Session Quality (0–10)
    if features.is_london_ny:
        sess_score = 10.0
    elif features.is_london or features.is_new_york:
        sess_score = 7.0
    elif features.is_asian:
        sess_score = 4.0
    else:
        sess_score = 2.0

    # 8. Regime Quality (0–10)
    reg_q = regime_quality_score(regime.regime)
    regime_score = reg_q * 10.0

    # 9. Spread Quality (0–5) — spread vs average
    spread_ratio = spread_pips / (avg_spread_pips + 1e-10)
    if spread_ratio <= 1.2:
        spread_score = 5.0
    elif spread_ratio <= 1.8:
        spread_score = 3.0
    elif spread_ratio <= 3.0:
        spread_score = 1.0
    else:
        spread_score = 0.0

    total = (ema_align + ema_sep + price_ema200 + atr_score + rsi_score +
             macd_score + sess_score + regime_score + spread_score)
    raw = min(total, MAX_SCORE)
    score = int(round(raw))

    tier: Tier
    if score >= 80:    tier = 'exceptional'
    elif score >= 65:  tier = 'aggressive'
    elif score >= 50:  tier = 'normal'
    else:              tier = 'blocked'

    block_reason = None
    should_publish = tier != 'blocked'

    if spread_ratio > 4.0:
        should_publish = False
        block_reason = f"Spread too wide: {spread_pips:.1f}x avg"
    elif features.insufficient_data:
        should_publish = False
        block_reason = "Insufficient data bars"

    bd = ConfidenceBreakdown(
        ema_alignment=ema_align,
        ema_separation=ema_sep,
        price_vs_ema200=price_ema200,
        atr_percentile=atr_score,
        rsi_momentum=rsi_score,
        macd_alignment=macd_score,
        session_quality=sess_score,
        regime_quality=regime_score,
        spread_quality=spread_score,
        total=total,
        raw_100=raw,
    )

    return ConfidenceResult(
        score=score, tier=tier, breakdown=bd,
        should_publish=should_publish, block_reason=block_reason,
    )


def _partial_ema_alignment(f: EngineFeatures, direction: Direction) -> bool:
    if direction == 'buy':
        return f.ema9 > f.ema21 or f.ema21 > f.ema50
    return f.ema9 < f.ema21 or f.ema21 < f.ema50


def tier_to_subscription(tier: Tier) -> str:
    """Map confidence tier to minimum subscription required."""
    return {
        'blocked':     'premium',   # blocked = don't publish
        'normal':      'starter',
        'aggressive':  'starter',
        'exceptional': 'free',      # high-confidence signals shared broadly
    }.get(tier, 'starter')
