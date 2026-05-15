"""
AlgoSphere Quant — Signal Confidence Scorer
Rule-based scoring engine (Phase 1). Ready to swap in ML model (Phase 2).

Architecture:
  Phase 1 (current): deterministic rule-based scoring
  Phase 2 (roadmap):  RandomForest / XGBoost trained on historical outcomes
  Phase 3 (roadmap):  Ensemble of models + regime-aware weighting
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from ml.feature_engineering import SignalFeatures


@dataclass
class ScoreResult:
    confidence: int          # 0–100
    quality_score: float     # 0–10
    grade: str               # A+, A, B+, B, C, D, F
    label: str
    breakdown: dict[str, float]
    should_publish: bool


def score_signal(
    features: SignalFeatures,
    risk_reward: float,
    regime: Optional[str] = None,
) -> ScoreResult:
    """
    Phase 1: Rule-based confidence scoring.
    Each dimension scores 0–20 points. Total: 100.
    """
    breakdown: dict[str, float] = {}

    # 1. Trend alignment (0–20)
    if features.trend_alignment == 1.0:
        trend = 20.0
    elif features.trend_alignment == -1.0:
        trend = 20.0  # strong bearish also fine if shorting
    else:
        trend = 8.0
    breakdown['trend'] = trend

    # 2. Risk/Reward (0–20)
    if risk_reward >= 3.0:
        rr = 20.0
    elif risk_reward >= 2.5:
        rr = 18.0
    elif risk_reward >= 2.0:
        rr = 15.0
    elif risk_reward >= 1.5:
        rr = 10.0
    else:
        rr = 4.0
    breakdown['rr'] = rr

    # 3. RSI quality (0–20) — avoid extremes
    rsi_raw = features.rsi * 100
    if 40 <= rsi_raw <= 65:
        mom = 20.0
    elif 35 <= rsi_raw <= 70:
        mom = 14.0
    elif 30 <= rsi_raw <= 75:
        mom = 8.0
    else:
        mom = 2.0  # overbought or oversold
    breakdown['momentum'] = mom

    # 4. Volatility (0–20) — ATR in healthy range
    atr_pct = features.atr_pct
    if 0.002 <= atr_pct <= 0.012:    # 0.2%–1.2% — ideal
        vol = 20.0
    elif 0.001 <= atr_pct <= 0.020:  # acceptable range
        vol = 12.0
    else:
        vol = 4.0                    # too quiet or too wild
    breakdown['volatility'] = vol

    # 5. Session quality (0–20)
    if features.is_london_ny_overlap:
        sess = 20.0
    elif features.is_london or features.is_new_york:
        sess = 16.0
    else:
        sess = 6.0
    breakdown['session'] = sess

    total = sum(breakdown.values())
    confidence = min(int(total), 100)
    quality = round(total / 10, 2)

    grade, label = _grade(quality)
    should_publish = confidence >= 55 and risk_reward >= 1.5

    return ScoreResult(
        confidence=confidence,
        quality_score=quality,
        grade=grade,
        label=label,
        breakdown=breakdown,
        should_publish=should_publish,
    )


def _grade(score: float) -> tuple[str, str]:
    if score >= 8.5: return 'A+', 'Institutional Grade'
    if score >= 7.5: return 'A', 'High Conviction'
    if score >= 6.5: return 'B+', 'Strong Setup'
    if score >= 5.5: return 'B', 'Standard'
    if score >= 4.5: return 'C', 'Below Average'
    if score >= 3.0: return 'D', 'Low Conviction'
    return 'F', 'Disqualified'


# ---------------------------------------------------------------------------
# Phase 2 placeholder — swap rule-based with trained model
# ---------------------------------------------------------------------------
class MLSignalScorer:
    """
    Placeholder for Phase 2 ML scorer.
    Load a trained RandomForest or XGBoost model from disk.

    Usage:
        scorer = MLSignalScorer.load('models/signal_rf_v1.pkl')
        confidence = scorer.predict(features_vector)
    """

    def __init__(self, model_path: Optional[str] = None):
        self.model = None
        self.model_path = model_path

    def load(self, path: str) -> 'MLSignalScorer':
        # Future: self.model = joblib.load(path)
        raise NotImplementedError("ML model not yet trained. Use rule-based scorer.")

    def predict(self, feature_vector: list[float]) -> int:
        """Return confidence score 0–100."""
        if self.model is None:
            raise RuntimeError("Model not loaded. Call load() first.")
        # Future: proba = self.model.predict_proba([feature_vector])[0][1]
        # return int(proba * 100)
        raise NotImplementedError
