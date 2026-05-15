"""
AlgoSphere Feature Engineering Engine
Computes the complete institutional feature set from OHLCV data.
All computation is pure-numpy for performance and zero-dependency portability.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional
import numpy as np


@dataclass
class OHLCVBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


@dataclass
class EngineFeatures:
    """Complete feature set for signal generation and confidence scoring."""
    # EMAs
    ema9:   float = 0.0
    ema21:  float = 0.0
    ema50:  float = 0.0
    ema200: float = 0.0
    close:  float = 0.0
    # ATR
    atr14: float = 0.0
    atr_pct: float = 0.0
    atr_percentile: float = 50.0    # 0–100, rank vs last 100 bars
    # RSI
    rsi14: float = 50.0
    # MACD
    macd_line: float = 0.0
    macd_signal: float = 0.0
    macd_histogram: float = 0.0
    # Bollinger Bands
    bb_upper: float = 0.0
    bb_middle: float = 0.0
    bb_lower: float = 0.0
    bb_width: float = 0.0
    bb_pct_b: float = 0.5           # 0=at lower, 1=at upper
    # Previous day levels
    pdh: float = 0.0                # Previous day high
    pdl: float = 0.0                # Previous day low
    # Structure
    der: float = 0.5                # Directional Efficiency Ratio [0,1]
    entropy: float = 1.0            # Shannon entropy of returns [0,∞]
    autocorr: float = 0.0           # 1-lag autocorrelation of returns [-1,1]
    # Derived
    ema_separation: float = 0.0     # (ema9-ema200) / atr14
    price_vs_ema200: float = 0.0    # (close - ema200) / atr14
    trend_aligned_bull: bool = False
    trend_aligned_bear: bool = False
    # Session
    hour_utc: int = 0
    is_london: bool = False
    is_new_york: bool = False
    is_london_ny: bool = False
    is_asian: bool = False
    # Valid flag
    valid: bool = True
    insufficient_data: bool = False


def compute_ema(prices: np.ndarray, period: int) -> np.ndarray:
    k = 2.0 / (period + 1)
    ema = np.empty_like(prices)
    ema[0] = prices[0]
    for i in range(1, len(prices)):
        ema[i] = prices[i] * k + ema[i - 1] * (1 - k)
    return ema


def compute_atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    tr = np.maximum(
        highs[1:] - lows[1:],
        np.maximum(
            np.abs(highs[1:] - closes[:-1]),
            np.abs(lows[1:] - closes[:-1])
        )
    )
    tr = np.insert(tr, 0, highs[0] - lows[0])
    # Wilder smoothing
    atr = np.empty_like(tr)
    atr[period - 1] = np.mean(tr[:period])
    for i in range(period, len(tr)):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    atr[:period - 1] = atr[period - 1]
    return atr


def compute_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    delta = np.diff(closes)
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    rsi_vals = [0.0] * period
    for i in range(period, len(delta)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else 100.0
        rsi_vals.append(100 - 100 / (1 + rs))
    return np.array(rsi_vals + [rsi_vals[-1]])  # pad to match closes length


def compute_macd(closes: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = compute_ema(closes, fast)
    ema_slow = compute_ema(closes, slow)
    macd_line = ema_fast - ema_slow
    macd_sig = compute_ema(macd_line, signal)
    return macd_line, macd_sig, macd_line - macd_sig


def compute_bollinger(closes: np.ndarray, period: int = 20, std: float = 2.0):
    middle = np.array([np.mean(closes[max(0, i - period):i + 1]) for i in range(len(closes))])
    stddev = np.array([np.std(closes[max(0, i - period):i + 1]) for i in range(len(closes))])
    upper = middle + std * stddev
    lower = middle - std * stddev
    return upper, middle, lower


def compute_der(closes: np.ndarray, window: int = 20) -> float:
    """Directional Efficiency Ratio: measures trend purity."""
    if len(closes) < window:
        return 0.5
    seg = closes[-window:]
    net = abs(seg[-1] - seg[0])
    total = sum(abs(seg[i] - seg[i - 1]) for i in range(1, len(seg)))
    return float(net / total) if total > 0 else 0.5


def compute_shannon_entropy(closes: np.ndarray, window: int = 20) -> float:
    """Shannon entropy of log-returns. High = chaotic, Low = structured."""
    if len(closes) < window + 1:
        return 1.0
    returns = np.diff(np.log(closes[-window - 1:]))
    # Bin into 10 buckets
    hist, _ = np.histogram(returns, bins=10, density=True)
    hist = hist[hist > 0]
    entropy = -np.sum(hist * np.log(hist + 1e-12))
    return float(entropy)


def compute_autocorr(closes: np.ndarray, lag: int = 1, window: int = 20) -> float:
    """1-lag autocorrelation of log-returns. Positive = trending, negative = mean-reverting."""
    if len(closes) < window + 1:
        return 0.0
    rets = np.diff(np.log(closes[-window - 1:]))
    if len(rets) <= lag:
        return 0.0
    return float(np.corrcoef(rets[:-lag], rets[lag:])[0, 1])


def session_flags(hour_utc: int) -> dict[str, bool]:
    return {
        'is_asian':    7 <= hour_utc < 9,
        'is_london':   8 <= hour_utc < 12,
        'is_new_york': 13 <= hour_utc < 17,
        'is_london_ny': 13 <= hour_utc < 16,
    }


def engineer_features(bars: list[OHLCVBar], hour_utc: int = 0) -> EngineFeatures:
    """
    Main feature engineering function.
    Requires at least 210 bars for full computation (EMA200 + buffer).
    Gracefully degrades with fewer bars.
    """
    MIN_BARS = 50
    f = EngineFeatures(hour_utc=hour_utc)

    if len(bars) < MIN_BARS:
        f.valid = False
        f.insufficient_data = True
        return f

    closes = np.array([b.close for b in bars], dtype=float)
    highs  = np.array([b.high  for b in bars], dtype=float)
    lows   = np.array([b.low   for b in bars], dtype=float)

    # EMAs
    f.ema9   = float(compute_ema(closes, 9)[-1])
    f.ema21  = float(compute_ema(closes, 21)[-1])
    f.ema50  = float(compute_ema(closes, 50)[-1])
    f.ema200 = float(compute_ema(closes, min(200, len(closes)))[-1])
    f.close  = float(closes[-1])

    # ATR
    atr_arr = compute_atr(highs, lows, closes, 14)
    f.atr14  = float(atr_arr[-1])
    f.atr_pct = f.atr14 / f.close if f.close > 0 else 0.0
    recent_atrs = atr_arr[-100:]
    f.atr_percentile = float(
        np.sum(recent_atrs <= f.atr14) / len(recent_atrs) * 100
    )

    # RSI
    rsi_arr = compute_rsi(closes, 14)
    f.rsi14 = float(rsi_arr[-1])

    # MACD
    ml, ms, mh = compute_macd(closes)
    f.macd_line, f.macd_signal, f.macd_histogram = float(ml[-1]), float(ms[-1]), float(mh[-1])

    # Bollinger Bands
    bb_u, bb_m, bb_l = compute_bollinger(closes)
    f.bb_upper, f.bb_middle, f.bb_lower = float(bb_u[-1]), float(bb_m[-1]), float(bb_l[-1])
    bb_range = f.bb_upper - f.bb_lower
    f.bb_width  = bb_range / f.bb_middle if f.bb_middle else 0.0
    f.bb_pct_b  = (f.close - f.bb_lower) / bb_range if bb_range > 0 else 0.5

    # PDH / PDL (approximate from last 24–26 H1 bars)
    day_bars = bars[-26:-2]
    f.pdh = max(b.high  for b in day_bars) if day_bars else f.close
    f.pdl = min(b.low   for b in day_bars) if day_bars else f.close

    # DER / Entropy / Autocorrelation
    f.der      = compute_der(closes, 20)
    f.entropy  = compute_shannon_entropy(closes, 20)
    f.autocorr = compute_autocorr(closes, 1, 20)

    # Derived
    atr = f.atr14 or 1.0
    f.ema_separation    = (f.ema9 - f.ema200) / atr
    f.price_vs_ema200   = (f.close - f.ema200) / atr
    f.trend_aligned_bull = (f.ema9 > f.ema21 > f.ema50 > f.ema200 and f.close > f.ema9)
    f.trend_aligned_bear = (f.ema9 < f.ema21 < f.ema50 < f.ema200 and f.close < f.ema9)

    # Session
    sess = session_flags(hour_utc)
    f.is_asian     = sess['is_asian']
    f.is_london    = sess['is_london']
    f.is_new_york  = sess['is_new_york']
    f.is_london_ny = sess['is_london_ny']

    f.valid = True
    return f
