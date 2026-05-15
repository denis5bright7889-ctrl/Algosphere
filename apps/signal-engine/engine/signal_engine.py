"""
AlgoSphere Ensemble Signal Engine
Three sub-strategies with weighted voting, regime-adaptive weights, and ATR-based TP/SL.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Literal
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
        # Continuation: BB upper break + MACD positive + DER > 0.4
        if (f.close > f.bb_upper and f.macd_histogram > 0 and
                f.der > 0.38 and f.rsi14 < 75):
            strength = weight * min(f.der, 1.0) * _rsi_quality(f.rsi14, 'buy')
            return StrategyVote('momentum_breakout', 'buy', strength,
                                f"BB upper break trend cont, RSI={f.rsi14:.1f}")

        if (f.close < f.bb_lower and f.macd_histogram < 0 and
                f.der > 0.38 and f.rsi14 > 25):
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


# ─── Ensemble Voting ────────────────────────────────────────────────────────

MIN_AGREEING = 2

def ensemble_signal(
    symbol: str,
    features: EngineFeatures,
    regime_result: RegimeResult,
) -> Optional[SignalProposal]:
    """
    Runs all three strategies with regime-adaptive weights and applies ensemble voting.
    Returns a SignalProposal if MIN_AGREEING strategies agree on direction.
    """
    w = regime_result.strategy_weights
    is_trending = regime_result.regime.value == 'trending'

    votes = [
        trend_continuation(features, w.get('trend_continuation', 0.33)),
        liquidity_sweep(features, w.get('liquidity_sweep', 0.33)),
        momentum_breakout(features, w.get('momentum_breakout', 0.34), is_trending),
    ]

    buy_votes  = [v for v in votes if v.direction == 'buy']
    sell_votes = [v for v in votes if v.direction == 'sell']

    if len(buy_votes) >= MIN_AGREEING:
        direction: Direction = 'buy'
        agreeing = buy_votes
    elif len(sell_votes) >= MIN_AGREEING:
        direction = 'sell'
        agreeing = sell_votes
    else:
        return None  # No consensus

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
