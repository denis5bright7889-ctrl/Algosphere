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
    BREAKOUT_EXPANSION = "expansion"  # alias preserved below — spec section 4 name
    EXPANSION      = "expansion"      # ATR rising into the middle band before peak vol
    TRANSITIONAL   = "transitional"   # ambiguous features — regime shift in progress
    EXHAUSTION     = "exhaustion"
    # Spec section 4 additions — both fully suppress trades because they
    # indicate a price action environment where signal edge collapses:
    NEWS_SHOCK     = "news_shock"     # vol explosion w/ chaos (event driven)
    LIQUIDITY_TRAP = "liquidity_trap" # PDH/PDL sweep + immediate reversion (stop-hunt)
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
    close = features.close
    pdh   = features.pdh
    pdl   = features.pdl
    atr   = features.atr14 or 1.0

    # --- NEWS_SHOCK: vol explosion + chaos (event-driven, suppress) ---
    # Spec section 4. Signature: ATR in the top percentile band AND
    # directional efficiency collapsed (price is bouncing chaotically)
    # AND entropy elevated. Different from HIGH_VOLATILITY because the
    # latter still has some directional energy.
    if atr_p >= 90 and der <= 0.15 and ent >= 2.8:
        regime = Regime.NEWS_SHOCK
        conf = min((atr_p - 90) / 10 * 0.5 + (0.15 - der) / 0.15 * 0.5, 1.0)
        weights = {'trend_continuation': 0.0, 'liquidity_sweep': 0.0, 'momentum_breakout': 0.0}
        desc = f"News shock — ATR_pct={atr_p:.0f}%, DER={der:.2f}, entropy={ent:.2f}"
        return RegimeResult(
            regime=regime, confidence=conf,
            der_score=der, entropy_score=ent, autocorr_score=ac,
            atr_percentile=atr_p, description=desc, strategy_weights=weights,
        )

    # --- LIQUIDITY_TRAP: PDH/PDL sweep + immediate reversion (stop-hunt) ---
    # Spec section 4. Signature: price has very recently swept beyond
    # PDH or PDL by less than 1 ATR AND closed back through it AND
    # autocorr is negative (mean-reverting micro-structure) AND DER is
    # low (no real follow-through). Classic stop hunt — fully suppress.
    if pdh > 0 and pdl > 0 and ac < -0.1 and der < 0.2:
        # Sweep + revert: close back inside the prior range by < 0.6 ATR
        # after an excursion above PDH or below PDL. Autocorr restated
        # tighter here so the trap only fires on confirmed micro reversal.
        swept_high = (close < pdh) and ((pdh - close) < atr * 0.6) and ac < -0.15
        swept_low  = (close > pdl) and ((close - pdl) < atr * 0.6) and ac < -0.15
        if swept_high or swept_low:
            regime = Regime.LIQUIDITY_TRAP
            conf = min(abs(ac) / 0.4 * 0.6 + (0.2 - der) / 0.2 * 0.4, 1.0)
            weights = {'trend_continuation': 0.0, 'liquidity_sweep': 0.0, 'momentum_breakout': 0.0}
            level = 'PDH' if swept_high else 'PDL'
            desc = f"Liquidity trap — {level} swept + reverted, DER={der:.2f}, autocorr={ac:.2f}"
            return RegimeResult(
                regime=regime, confidence=conf,
                der_score=der, entropy_score=ent, autocorr_score=ac,
                atr_percentile=atr_p, description=desc, strategy_weights=weights,
            )

    # --- Trending: high DER + positive autocorr + moderate entropy ---
    # DER is the Kaufman Efficiency Ratio (0..1). Empirically ~0.30 marks a
    # genuine trend; the old 0.45 floor was unreachable in practice (live DER
    # tops out ~0.19 in chop, ~0.30-0.45 in real trends) so 'trending' never
    # classified — starving the ensemble. Recalibrated to the real ER scale.
    if der >= 0.30 and ac >= 0.08 and ent < 2.5 and atr_p >= 25:
        regime = Regime.TRENDING
        conf = min((der - 0.30) / 0.3 + (ac / 0.5) * 0.3, 1.0)
        weights = {'trend_continuation': 0.6, 'liquidity_sweep': 0.3, 'momentum_breakout': 0.1}
        desc = f"Trending — DER={der:.2f}, autocorr={ac:.2f}"

    # --- High volatility: high ATR percentile + high entropy ---
    elif atr_p >= 75 and ent >= 2.5:
        regime = Regime.HIGH_VOLATILITY
        conf = min((atr_p - 75) / 25, 1.0)
        weights = {'momentum_breakout': 0.5, 'liquidity_sweep': 0.3, 'trend_continuation': 0.2}
        desc = f"High Volatility — ATR_pct={atr_p:.0f}%, entropy={ent:.2f}"

    # --- Exhaustion: very low ATR percentile + very low DER (true chop) ---
    elif atr_p <= 15 and der <= 0.10:
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

    # --- Expansion: ATR climbing into the middle band with energy building ---
    # Carved out of UNKNOWN — vol elevated but not yet HIGH_VOLATILITY, with
    # enough directional energy to suggest a breakout setup rather than chop.
    elif 50 <= atr_p < 75 and der >= 0.20 and ent < 3.0:
        regime = Regime.EXPANSION
        conf = min((atr_p - 50) / 25 * 0.7 + (der - 0.20) / 0.2 * 0.3, 1.0)
        weights = {'momentum_breakout': 0.5, 'trend_continuation': 0.35, 'liquidity_sweep': 0.15}
        desc = f"Expansion — vol building (ATR_pct={atr_p:.0f}%), DER={der:.2f}"

    # --- Transitional: features ambiguous, regime shift in progress ---
    # Carved out of UNKNOWN — moderate DER without persistence direction
    # (autocorr near zero), or high entropy with moderate DER. Strategy
    # mix is balanced and confidence intentionally low.
    elif 0.12 <= der < 0.30 and abs(ac) < 0.12:
        regime = Regime.TRANSITIONAL
        conf = 0.45
        weights = {'trend_continuation': 0.35, 'liquidity_sweep': 0.35, 'momentum_breakout': 0.3}
        desc = f"Transitional — regime shift in progress (DER={der:.2f}, autocorr={ac:.2f})"

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
    return regime in (Regime.EXHAUSTION, Regime.NEWS_SHOCK, Regime.LIQUIDITY_TRAP)


def regime_quality_score(regime: Regime) -> float:
    """0–1 quality multiplier for confidence scoring.

    Expansion = 0.75 (breakout setups have real edge but with wider stops).
    Transitional = 0.5 (intentionally below UNKNOWN's 0.6 — we KNOW
    the regime is shifting, which is exactly when signal quality suffers).
    """
    return {
        Regime.TRENDING:        1.0,
        Regime.MEAN_REVERSION:  0.85,
        Regime.HIGH_VOLATILITY: 0.65,
        Regime.EXPANSION:       0.75,
        Regime.TRANSITIONAL:    0.5,
        Regime.EXHAUSTION:      0.0,
        Regime.NEWS_SHOCK:      0.0,
        Regime.LIQUIDITY_TRAP:  0.0,
        Regime.UNKNOWN:         0.6,
    }.get(regime, 0.5)
