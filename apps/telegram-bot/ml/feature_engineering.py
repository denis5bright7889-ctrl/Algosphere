"""
AlgoSphere Quant — Signal Feature Engineering Pipeline
Transforms raw OHLCV data into ML-ready feature vectors.

Usage (future):
    from ml.feature_engineering import build_features
    features = build_features(ohlcv_df, symbol='XAUUSD', timeframe='H1')
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
import math


@dataclass
class OHLCVBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


@dataclass
class SignalFeatures:
    """
    Feature vector used for ML scoring.
    All features are normalised to [0, 1] or [-1, 1] ranges.
    """
    # Trend features
    ema20_distance: float        # (price - EMA20) / ATR
    ema50_distance: float        # (price - EMA50) / ATR
    ema200_distance: float       # (price - EMA200) / ATR
    trend_alignment: float       # 1.0 = all EMAs aligned bull, -1.0 = bear
    adx: float                   # 0–100 normalised to 0–1

    # Momentum features
    rsi: float                   # 0–100 normalised to 0–1
    macd_histogram: float        # normalised by ATR
    stoch_k: float               # 0–100 normalised
    stoch_d: float

    # Volatility features
    atr_pct: float               # ATR / price
    bb_width: float              # Bollinger band width / price
    high_low_range: float        # (high - low) / ATR over N bars

    # Structure features
    at_support: float            # 1.0 = price at key support
    at_resistance: float         # 1.0 = price at key resistance
    near_round_number: float     # 1.0 = within 10 pips of round number

    # Session features
    is_london: float             # binary
    is_new_york: float
    is_london_ny_overlap: float
    day_of_week: float           # 0=Mon, 4=Fri normalised

    # Contextual
    risk_reward: float           # normalised 0–5 → 0–1
    spread_vs_atr: float         # spread / ATR


def compute_ema(prices: list[float], period: int) -> list[float]:
    """Exponential moving average."""
    k = 2.0 / (period + 1)
    ema = [prices[0]]
    for p in prices[1:]:
        ema.append(p * k + ema[-1] * (1 - k))
    return ema


def compute_atr(bars: list[OHLCVBar], period: int = 14) -> list[float]:
    """Average True Range."""
    trs = [bars[0].high - bars[0].low]
    for i in range(1, len(bars)):
        prev_close = bars[i - 1].close
        tr = max(
            bars[i].high - bars[i].low,
            abs(bars[i].high - prev_close),
            abs(bars[i].low - prev_close),
        )
        trs.append(tr)
    # Smooth with Wilder's method
    atr = [sum(trs[:period]) / period]
    for tr in trs[period:]:
        atr.append((atr[-1] * (period - 1) + tr) / period)
    return atr


def compute_rsi(closes: list[float], period: int = 14) -> list[float]:
    """Relative Strength Index."""
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(d, 0) for d in deltas]
    losses = [abs(min(d, 0)) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    result = []

    for i in range(period, len(deltas)):
        if avg_loss == 0:
            result.append(100.0)
        else:
            rs = avg_gain / avg_loss
            result.append(100 - 100 / (1 + rs))
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    return result


def build_features(
    bars: list[OHLCVBar],
    entry: float,
    stop_loss: float,
    take_profit: float,
    spread_pips: float = 2.0,
    session: str = 'london',
) -> Optional[SignalFeatures]:
    """
    Build a feature vector for signal scoring.
    Requires at least 200 bars of history.
    """
    if len(bars) < 200:
        return None

    closes = [b.close for b in bars]
    ema20 = compute_ema(closes, 20)[-1]
    ema50 = compute_ema(closes, 50)[-1]
    ema200 = compute_ema(closes, 200)[-1]
    atr_series = compute_atr(bars, 14)
    atr = atr_series[-1] if atr_series else 1.0
    rsi_series = compute_rsi(closes, 14)
    rsi = rsi_series[-1] if rsi_series else 50.0

    price = closes[-1]

    # Trend alignment: +1 if price > ema20 > ema50 > ema200
    if price > ema20 > ema50 > ema200:
        trend_alignment = 1.0
    elif price < ema20 < ema50 < ema200:
        trend_alignment = -1.0
    else:
        trend_alignment = 0.0

    risk = abs(entry - stop_loss)
    reward = abs(take_profit - entry)
    rr = reward / risk if risk > 0 else 0

    return SignalFeatures(
        ema20_distance=(price - ema20) / atr,
        ema50_distance=(price - ema50) / atr,
        ema200_distance=(price - ema200) / atr,
        trend_alignment=trend_alignment,
        adx=0.5,  # placeholder — ADX requires 14-bar DI calculation
        rsi=rsi / 100,
        macd_histogram=0.0,  # placeholder
        stoch_k=0.5,
        stoch_d=0.5,
        atr_pct=atr / price,
        bb_width=0.0,
        high_low_range=0.0,
        at_support=0.0,
        at_resistance=0.0,
        near_round_number=_near_round(price),
        is_london=1.0 if 'london' in session else 0.0,
        is_new_york=1.0 if 'new_york' in session else 0.0,
        is_london_ny_overlap=1.0 if session == 'london_ny' else 0.0,
        day_of_week=0.5,
        risk_reward=min(rr / 5, 1.0),
        spread_vs_atr=spread_pips / (atr * 10000) if atr > 0 else 0,
    )


def _near_round(price: float, tolerance: float = 0.0010) -> float:
    """Return 1.0 if price is within `tolerance` of a round number."""
    rounded = round(price * 100) / 100
    return 1.0 if abs(price - rounded) < tolerance else 0.0


def features_to_vector(f: SignalFeatures) -> list[float]:
    """Convert features dataclass to flat list for ML input."""
    return [
        f.ema20_distance, f.ema50_distance, f.ema200_distance,
        f.trend_alignment, f.adx, f.rsi, f.macd_histogram,
        f.stoch_k, f.stoch_d, f.atr_pct, f.bb_width,
        f.high_low_range, f.at_support, f.at_resistance,
        f.near_round_number, f.is_london, f.is_new_york,
        f.is_london_ny_overlap, f.day_of_week,
        f.risk_reward, f.spread_vs_atr,
    ]
