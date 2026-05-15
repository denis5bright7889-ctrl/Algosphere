"""
AlgoSphere Regime Classification Engine
Classifies current market regime using DER, entropy, autocorrelation, and ATR percentile.
"""
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from engine.feature_engineer import EngineFeatures


class Regime(str, Enum):
    TRENDING       = "trending"
    MEAN_REVERSION = "ranging"
    RANGING        = "ranging"
    HIGH_VOLATILITY= "volatile"
    EXHAUSTION     = "exhaustion"
    UNKNOWN        = "unknown"


@dataclass
class RegimeResult:
    regime: Regime
    confidence: float       # 0–1
    der_score: float
    entropy_score: float
    autocorr_score: float
    atr_percentile: float
    description: str
    strategy_weights: dict[str, float]


def classify_regime(features: EngineFeatures) -> RegimeResult:
    """
    Classifies market regime using a multi-factor scoring approach.

    Regime → Strategy weight mapping:
      TRENDING       → trend_continuation: 0.6, liquidity_sweep: 0.3, momentum_breakout: 0.1
      MEAN_REVERSION → liquidity_sweep:    0.6, trend_continuation: 0.2, momentum_breakout: 0.2
      HIGH_VOLATILITY→ momentum_breakout:  0.5, liquidity_sweep:    0.3, trend_continuation: 0.2
      EXHAUSTION     → (suppress all signals — circuit breaker territory)
    """
    der   = features.der
    ent   = features.entropy
    ac    = features.autocorr
    atr_p = features.atr_percentile

    # --- Trending: high DER + positive autocorr + moderate entropy ---
    if der >= 0.45 and ac >= 0.1 and ent < 2.5 and atr_p >= 25:
        regime = Regime.TRENDING
        conf = min((der - 0.45) / 0.3 + (ac / 0.5) * 0.3, 1.0)
        weights = {'trend_continuation': 0.6, 'liquidity_sweep': 0.3, 'momentum_breakout': 0.1}
        desc = f"Trending — DER={der:.2f}, autocorr={ac:.2f}"

    # --- High volatility: high ATR percentile + high entropy ---
    elif atr_p >= 75 and ent >= 2.5:
        regime = Regime.HIGH_VOLATILITY
        conf = min((atr_p - 75) / 25, 1.0)
        weights = {'momentum_breakout': 0.5, 'liquidity_sweep': 0.3, 'trend_continuation': 0.2}
        desc = f"High Volatility — ATR_pct={atr_p:.0f}%, entropy={ent:.2f}"

    # --- Exhaustion: very low ATR percentile + low DER ---
    elif atr_p <= 15 and der <= 0.25:
        regime = Regime.EXHAUSTION
        conf = 0.8
        weights = {'trend_continuation': 0.0, 'liquidity_sweep': 0.1, 'momentum_breakout': 0.0}
        desc = f"Exhaustion/Dead — ATR_pct={atr_p:.0f}%, DER={der:.2f}"

    # --- Mean reversion: negative autocorr + low-moderate entropy ---
    elif ac <= -0.1 and ent < 2.0:
        regime = Regime.MEAN_REVERSION
        conf = min(abs(ac) / 0.4, 1.0)
        weights = {'liquidity_sweep': 0.6, 'trend_continuation': 0.2, 'momentum_breakout': 0.2}
        desc = f"Mean Reversion/Ranging — autocorr={ac:.2f}"

    else:
        regime = Regime.UNKNOWN
        conf = 0.4
        weights = {'trend_continuation': 0.33, 'liquidity_sweep': 0.33, 'momentum_breakout': 0.34}
        desc = "Undetermined regime"

    return RegimeResult(
        regime=regime,
        confidence=conf,
        der_score=der,
        entropy_score=ent,
        autocorr_score=ac,
        atr_percentile=atr_p,
        description=desc,
        strategy_weights=weights,
    )


def regime_suppresses_trading(regime: Regime) -> bool:
    """Returns True if the regime should block all signal generation."""
    return regime == Regime.EXHAUSTION


def regime_quality_score(regime: Regime) -> float:
    """0–1 quality multiplier for confidence scoring."""
    return {
        Regime.TRENDING:       1.0,
        Regime.MEAN_REVERSION: 0.85,
        Regime.HIGH_VOLATILITY: 0.65,
        Regime.EXHAUSTION:     0.0,
        Regime.UNKNOWN:        0.6,
    }.get(regime, 0.5)
