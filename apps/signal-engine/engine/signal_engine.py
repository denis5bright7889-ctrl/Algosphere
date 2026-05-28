"""
AlgoSphere Ensemble Signal Engine
Three sub-strategies with weighted voting, regime-adaptive weights, and ATR-based TP/SL.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Literal
from loguru import logger
from engine.feature_engineer import EngineFeatures
from engine.regime_engine import RegimeResult


Direction = Literal['buy', 'sell']


@dataclass
class StrategyVote:
    strategy: str
    direction: Optional[Direction]
    strength: float     # 0–1
    reason: str


@dataclass
class SignalProposal:
    symbol: str
    direction: Direction
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    take_profit_3: float
    risk_reward: float
    agreeing_count: int
    total_vote_strength: float
    strategies_voted: list[str]
    reasons: list[str]


# ─── Strategy 1: Trend Continuation ────────────────────────────────────────

def trend_continuation(f: EngineFeatures, weight: float) -> StrategyVote:
    """
    Buys when all EMAs aligned bullish and price pulls back to EMA21.
    Sells when all EMAs aligned bearish and price rebounds to EMA21.
    """
    if f.trend_aligned_bull and 35 <= f.rsi14 <= 65 and f.macd_histogram > 0:
        strength = weight * _rsi_quality(f.rsi14, 'buy') * (0.7 + 0.3 * min(f.der, 1.0))
        return StrategyVote('trend_continuation', 'buy', strength,
                            f"EMA bull alignment, RSI={f.rsi14:.1f}, DER={f.der:.2f}")

    if f.trend_aligned_bear and 35 <= f.rsi14 <= 65 and f.macd_histogram < 0:
        strength = weight * _rsi_quality(f.rsi14, 'sell') * (0.7 + 0.3 * min(f.der, 1.0))
        return StrategyVote('trend_continuation', 'sell', strength,
                            f"EMA bear alignment, RSI={f.rsi14:.1f}, DER={f.der:.2f}")

    return StrategyVote('trend_continuation', None, 0.0, "No trend alignment")


# ─── Strategy 2: Liquidity Sweep ────────────────────────────────────────────

def liquidity_sweep(f: EngineFeatures, weight: float) -> StrategyVote:
    """
    Detects sweeps of PDH/PDL followed by reversal.
    Classic ICT liquidity grab into institutional reversal.
    """
    atr = f.atr14 or 1.0
    # Sweep below PDL + close back above → bullish
    if f.close > f.pdl and (f.close - f.pdl) < atr and f.rsi14 < 42:
        strength = weight * (1 - f.rsi14 / 50) * 0.9
        return StrategyVote('liquidity_sweep', 'buy', strength,
                            f"PDL sweep buy, close={f.close:.5f}, PDL={f.pdl:.5f}")

    # Sweep above PDH + close back below → bearish
    if f.close < f.pdh and (f.pdh - f.close) < atr and f.rsi14 > 58:
        strength = weight * (f.rsi14 / 50 - 1) * 0.9
        return StrategyVote('liquidity_sweep', 'sell', strength,
                            f"PDH sweep sell, close={f.close:.5f}, PDH={f.pdh:.5f}")

    return StrategyVote('liquidity_sweep', None, 0.0, "No liquidity sweep detected")


# ─── Strategy 3: Momentum Breakout ──────────────────────────────────────────

def momentum_breakout(f: EngineFeatures, weight: float, is_trending: bool = False) -> StrategyVote:
    """
    BB breakout + MACD momentum confirmation.
    In trending regime → continuation breakout.
    In ranging regime → fades breakout (reversed logic).
    """
    atr = f.atr14 or 1.0

    if is_trending:
        # Continuation: BB break + MACD + DER. DER is the Kaufman Efficiency
        # Ratio (0..1); 0.20 marks meaningful directional efficiency. Old
        # 0.38 floor was effectively unreachable (live DER ~0.1-0.3) so this
        # branch never fired even in 'trending' regimes.
        if (f.close > f.bb_upper and f.macd_histogram > 0 and
                f.der > 0.20 and f.rsi14 < 75):
            strength = weight * min(f.der, 1.0) * _rsi_quality(f.rsi14, 'buy')
            return StrategyVote('momentum_breakout', 'buy', strength,
                                f"BB upper break trend cont, RSI={f.rsi14:.1f}")

        if (f.close < f.bb_lower and f.macd_histogram < 0 and
                f.der > 0.20 and f.rsi14 > 25):
            strength = weight * min(f.der, 1.0) * _rsi_quality(f.rsi14, 'sell')
            return StrategyVote('momentum_breakout', 'sell', strength,
                                f"BB lower break trend cont, RSI={f.rsi14:.1f}")
    else:
        # Mean-reversion: BB extreme + RSI extreme → fade
        if f.bb_pct_b >= 0.95 and f.rsi14 >= 70:
            strength = weight * 0.8
            return StrategyVote('momentum_breakout', 'sell', strength,
                                f"BB upper extreme fade, RSI={f.rsi14:.1f}")
        if f.bb_pct_b <= 0.05 and f.rsi14 <= 30:
            strength = weight * 0.8
            return StrategyVote('momentum_breakout', 'buy', strength,
                                f"BB lower extreme fade, RSI={f.rsi14:.1f}")

    return StrategyVote('momentum_breakout', None, 0.0, "No momentum breakout")


# ─── Strategy 4: Volatility Expansion Breakout ──────────────────────────────

def volatility_expansion(f: EngineFeatures, weight: float) -> StrategyVote:
    """Break of a Bollinger band while volatility is EXPANDING (high ATR
    percentile) and MACD confirms — a genuine range-break, not chop noise."""
    if (f.close > f.bb_upper and f.atr_percentile >= 55 and
            f.macd_histogram > 0 and f.rsi14 < 72):
        strength = weight * min(0.4 + f.atr_percentile / 140, 1.0) * _rsi_quality(f.rsi14, 'buy')
        return StrategyVote('volatility_expansion', 'buy', strength,
                            f"BB upper break, ATR%ile={f.atr_percentile:.0f}")
    if (f.close < f.bb_lower and f.atr_percentile >= 55 and
            f.macd_histogram < 0 and f.rsi14 > 28):
        strength = weight * min(0.4 + f.atr_percentile / 140, 1.0) * _rsi_quality(f.rsi14, 'sell')
        return StrategyVote('volatility_expansion', 'sell', strength,
                            f"BB lower break, ATR%ile={f.atr_percentile:.0f}")
    return StrategyVote('volatility_expansion', None, 0.0, "No volatility expansion break")


# ─── Strategy 5: ATR Compression Release ────────────────────────────────────

def atr_compression_release(f: EngineFeatures, weight: float) -> StrategyVote:
    """Coiled volatility (low ATR percentile) releasing through a band — the
    classic squeeze breakout. Distinct from expansion: fires FROM compression."""
    if f.atr_percentile <= 35 and f.der > 0.15:
        if f.close > f.bb_upper and f.macd_histogram > 0:
            strength = weight * (0.6 + 0.4 * min(f.der, 1.0))
            return StrategyVote('atr_compression_release', 'buy', strength,
                                f"Squeeze release up, ATR%ile={f.atr_percentile:.0f}")
        if f.close < f.bb_lower and f.macd_histogram < 0:
            strength = weight * (0.6 + 0.4 * min(f.der, 1.0))
            return StrategyVote('atr_compression_release', 'sell', strength,
                                f"Squeeze release down, ATR%ile={f.atr_percentile:.0f}")
    return StrategyVote('atr_compression_release', None, 0.0, "No squeeze release")


# ─── Strategy 6: Mean Reversion Exhaustion ──────────────────────────────────

def mean_reversion_exhaustion(f: EngineFeatures, weight: float) -> StrategyVote:
    """Band + RSI extreme in a mean-reverting tape (autocorr ≤ 0) → fade the
    exhausted move. Self-gates to non-trending conditions via autocorr."""
    if f.autocorr > 0.1:
        return StrategyVote('mean_reversion_exhaustion', None, 0.0, "Trending tape — no fade")
    if f.bb_pct_b <= 0.05 and f.rsi14 <= 30:
        return StrategyVote('mean_reversion_exhaustion', 'buy', weight * 0.8,
                            f"Oversold exhaustion, RSI={f.rsi14:.1f}")
    if f.bb_pct_b >= 0.95 and f.rsi14 >= 70:
        return StrategyVote('mean_reversion_exhaustion', 'sell', weight * 0.8,
                            f"Overbought exhaustion, RSI={f.rsi14:.1f}")
    return StrategyVote('mean_reversion_exhaustion', None, 0.0, "No exhaustion")


# ─── Strategy 7: Session Open Momentum ──────────────────────────────────────

def session_open_momentum(f: EngineFeatures, weight: float) -> StrategyVote:
    """Trend-aligned momentum during the London / New York sessions, when
    institutional flow is heaviest. Quiet in the Asian / off-hours tape."""
    if not (f.is_london or f.is_new_york or f.is_london_ny):
        return StrategyVote('session_open_momentum', None, 0.0, "Outside London/NY session")
    if f.trend_aligned_bull and f.macd_histogram > 0 and f.der > 0.20 and 40 <= f.rsi14 <= 70:
        strength = weight * min(0.5 + f.der, 1.0)
        return StrategyVote('session_open_momentum', 'buy', strength,
                            f"Session momentum up, DER={f.der:.2f}")
    if f.trend_aligned_bear and f.macd_histogram < 0 and f.der > 0.20 and 30 <= f.rsi14 <= 60:
        strength = weight * min(0.5 + f.der, 1.0)
        return StrategyVote('session_open_momentum', 'sell', strength,
                            f"Session momentum down, DER={f.der:.2f}")
    return StrategyVote('session_open_momentum', None, 0.0, "No session momentum")


# ─── Strategy 8: Displacement Momentum (price-action) ───────────────────────

def displacement_momentum(f: EngineFeatures, weight: float) -> StrategyVote:
    """Impulsive directional displacement: strong EMA separation + high
    directional efficiency + MACD impulse. Detects institutional-style
    displacement via PRICE ACTION (not on-chain wallet data — that feed
    isn't available to this engine)."""
    if f.ema_separation > 1.5 and f.der > 0.30 and f.macd_histogram > 0 and f.close > f.ema21:
        strength = weight * min(f.der, 1.0) * _rsi_quality(f.rsi14, 'buy')
        return StrategyVote('displacement_momentum', 'buy', strength,
                            f"Bullish displacement, sep={f.ema_separation:.2f}")
    if f.ema_separation < -1.5 and f.der > 0.30 and f.macd_histogram < 0 and f.close < f.ema21:
        strength = weight * min(f.der, 1.0) * _rsi_quality(f.rsi14, 'sell')
        return StrategyVote('displacement_momentum', 'sell', strength,
                            f"Bearish displacement, sep={f.ema_separation:.2f}")
    return StrategyVote('displacement_momentum', None, 0.0, "No displacement")


# ─── Ensemble: Weighted Probabilistic Decisioning (institutional v2) ─────────
#
# Replaces the old hard 2-of-3 consensus (which starved in ranging / mixed
# regimes — see signal-engine logs: every cycle STRATEGY_SIGNAL_REJECTED)
# with a signed, weight-aware probabilistic vote.
#
#   weighted_score = Σ ( direction_sign × strength )
#
# where `strength` already folds in the regime engine-weight × signal
# quality. Contradictions CANCEL in the signed sum instead of hard-blocking,
# and aligned-but-weak signals AGGREGATE past the threshold. A direction is
# asserted only when |weighted_score| clears a regime-adaptive threshold T:
# lower in directional regimes (easier entries), higher in chop (avoid
# noise), widest in transition / exhaustion (unstable → demand a stronger
# net edge).
#
# This is the L3 aggregation layer ONLY. All safety is UNCHANGED and lives
# downstream (L4): confidence scoring, the signal gate, the AUTHORITATIVE
# institutional risk gate, and the dry-run gate all still run on every
# proposal this produces. Low agreement no longer forces rejection; a real
# AVOID still comes from the risk layer, not from vote-counting.

# Regime-adaptive decision thresholds (keyed on Regime.value).
_REGIME_THRESHOLD: dict[str, float] = {
    'trending':     0.12,   # directional → easier entries
    'expansion':    0.14,   # vol building into a move
    'volatile':     0.20,   # high vol → require a stronger net edge
    'ranging':      0.20,   # chop → avoid noise
    'transitional': 0.22,   # regime shift → widen the neutral zone
    'exhaustion':   0.24,   # unstable → demand strong net edge
    'unknown':      0.24,
}
_DEFAULT_THRESHOLD = 0.22
TOTAL_ENGINES = 8

# Base weights for the strategies the regime engine doesn't explicitly weight
# (the 5 added in Phase 2). The regime engine still weights the original 3;
# these self-gate by regime through their own conditions (session windows,
# autocorr, ATR percentile), so a modest fixed base weight is appropriate.
_EXTRA_STRATEGY_WEIGHTS = {
    'volatility_expansion':     0.25,
    'atr_compression_release':  0.22,
    'mean_reversion_exhaustion':0.22,
    'session_open_momentum':    0.25,
    'displacement_momentum':    0.28,
}


def _threshold_for(regime_value: str) -> float:
    return _REGIME_THRESHOLD.get(regime_value, _DEFAULT_THRESHOLD)


def _signed(v: StrategyVote) -> float:
    """Vote as a signed contribution: buy = +strength, sell = −strength."""
    if v.direction == 'buy':  return +v.strength
    if v.direction == 'sell': return -v.strength
    return 0.0


def ensemble_signal(
    symbol: str,
    features: EngineFeatures,
    regime_result: RegimeResult,
    data_completeness: float = 1.0,
) -> Optional[SignalProposal]:
    """
    Weighted probabilistic ensemble. Produces a SignalProposal when the net
    weighted score clears the regime-adaptive threshold T. No hard consensus
    requirement — aligned weak signals aggregate, and contradictions net out
    rather than forcing rejection.

    `data_completeness` ∈ [0.3, 1.0] dampens the score for symbols served
    from stale / degraded data (e.g. persisted bars during a provider outage)
    so the engine doesn't over-rely on whichever asset class happens to have
    live data. It NEVER blocks — only reduces conviction. Live data = 1.0.
    """
    w = regime_result.strategy_weights
    regime_value = regime_result.regime.value
    is_trending = regime_value == 'trending'

    votes = [
        # Original 3 — regime-weighted by the regime engine.
        trend_continuation(features, w.get('trend_continuation', 0.33)),
        liquidity_sweep(features, w.get('liquidity_sweep', 0.33)),
        momentum_breakout(features, w.get('momentum_breakout', 0.34), is_trending),
        # Phase-2 additions — independent voters, self-gating by regime/session.
        volatility_expansion(features,     w.get('volatility_expansion',     _EXTRA_STRATEGY_WEIGHTS['volatility_expansion'])),
        atr_compression_release(features,  w.get('atr_compression_release',  _EXTRA_STRATEGY_WEIGHTS['atr_compression_release'])),
        mean_reversion_exhaustion(features,w.get('mean_reversion_exhaustion',_EXTRA_STRATEGY_WEIGHTS['mean_reversion_exhaustion'])),
        session_open_momentum(features,    w.get('session_open_momentum',    _EXTRA_STRATEGY_WEIGHTS['session_open_momentum'])),
        displacement_momentum(features,    w.get('displacement_momentum',    _EXTRA_STRATEGY_WEIGHTS['displacement_momentum'])),
    ]

    completeness = max(0.3, min(1.0, data_completeness))
    raw_score = sum(_signed(v) for v in votes)
    # final_score = Σ(signal × weight) × data_completeness_factor
    weighted_score = raw_score * completeness
    voted = [v for v in votes if v.direction is not None]
    valid_votes = len(voted)
    # Signal liquidity (FIX 2): how many engines actually voted. Used for
    # observability + confidence context — NEVER to block trading.
    signal_liquidity = round(valid_votes / TOTAL_ENGINES, 2)
    T = _threshold_for(regime_value)

    direction: Optional[Direction] = None
    if weighted_score > T:
        direction = 'buy'
    elif weighted_score < -T:
        direction = 'sell'

    # Observability: log whenever ANY strategy fired. Quiet on a dead tape.
    if voted:
        brk = ', '.join(f"{v.strategy}={v.direction}({v.strength:.2f})" for v in voted)
        tag = 'STRATEGY_SIGNAL_ACCEPTED' if direction else 'STRATEGY_SIGNAL_REJECTED'
        logger.info(f"[{symbol}] {tag} regime={regime_value} votes=[{brk}] "
                    f"score={weighted_score:+.3f} T={T:.2f} liquidity={signal_liquidity} "
                    f"completeness={completeness:.2f}")

    if direction is None:
        return None

    agreeing = [v for v in votes if v.direction == direction]
    strength = sum(v.strength for v in agreeing)
    entry = features.close
    atr   = features.atr14

    # ATR-based TP/SL
    if direction == 'buy':
        sl  = entry - 1.2 * atr
        tp1 = entry + 1.8 * atr
        tp2 = entry + 2.5 * atr
        tp3 = entry + 3.5 * atr
    else:
        sl  = entry + 1.2 * atr
        tp1 = entry - 1.8 * atr
        tp2 = entry - 2.5 * atr
        tp3 = entry - 3.5 * atr

    risk   = abs(entry - sl)
    reward = abs(tp1 - entry)
    rr     = round(reward / risk, 2) if risk > 0 else 0.0

    return SignalProposal(
        symbol=symbol,
        direction=direction,
        entry=round(entry, 5),
        stop_loss=round(sl, 5),
        take_profit_1=round(tp1, 5),
        take_profit_2=round(tp2, 5),
        take_profit_3=round(tp3, 5),
        risk_reward=rr,
        agreeing_count=len(agreeing),
        total_vote_strength=round(strength, 3),
        strategies_voted=[v.strategy for v in agreeing],
        reasons=[v.reason for v in agreeing],
    )


def _rsi_quality(rsi: float, direction: Direction) -> float:
    """RSI quality multiplier. Rewards non-extreme RSI for trend entries."""
    if direction == 'buy':
        if 45 <= rsi <= 60: return 1.0
        if 40 <= rsi <= 65: return 0.85
        if 35 <= rsi <= 70: return 0.65
        return 0.3
    else:
        if 40 <= rsi <= 55: return 1.0
        if 35 <= rsi <= 60: return 0.85
        if 30 <= rsi <= 65: return 0.65
        return 0.3
