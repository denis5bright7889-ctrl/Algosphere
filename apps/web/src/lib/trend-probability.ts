/**
 * AI Trend Probability — deterministic logistic-blend over technical features.
 *
 * Not a true ML model (no training data here), but a transparent weighted scorer
 * that combines EMA alignment, ATR percentile, RSI position, MACD momentum, and
 * trend persistence into a 0–100% probability the next bar continues the trend.
 *
 * Same feature set our signal engine uses, so users see a consistent view.
 */

export interface TrendInputs {
  closes:    number[]      // recent close prices, oldest → newest
  highs?:    number[]
  lows?:     number[]
  lookback?: number        // default 50
}

export interface TrendProbability {
  direction:        'up' | 'down' | 'neutral'
  probability:      number   // 0-100
  factors: {
    ema_alignment:    number   // -1..1
    momentum:         number
    rsi_position:     number
    macd_signal:      number
    volatility:       number
    persistence:      number
  }
  reasons:          string[]
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0] ?? 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    prev = i === 0 ? v : v * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!
    if (d > 0) gain += d; else loss -= d
  }
  let avgG = gain / period, avgL = loss / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!
    const g = Math.max(d, 0), l = Math.max(-d, 0)
    avgG = (avgG * (period - 1) + g) / period
    avgL = (avgL * (period - 1) + l) / period
  }
  if (avgL === 0) return 100
  return 100 - 100 / (1 + avgG / avgL)
}

function macdHist(closes: number[]): number {
  if (closes.length < 26) return 0
  const e12 = ema(closes, 12), e26 = ema(closes, 26)
  const macd = closes.map((_, i) => (e12[i] ?? 0) - (e26[i] ?? 0))
  const signal = ema(macd, 9)
  return (macd.at(-1) ?? 0) - (signal.at(-1) ?? 0)
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function computeTrendProbability(inp: TrendInputs): TrendProbability {
  const closes = inp.closes
  if (closes.length < 50) {
    return {
      direction: 'neutral', probability: 50,
      factors: { ema_alignment: 0, momentum: 0, rsi_position: 0, macd_signal: 0, volatility: 0, persistence: 0 },
      reasons: ['Need ≥50 bars for a meaningful read'],
    }
  }

  const last = closes.at(-1)!
  const e9  = ema(closes, 9).at(-1)!
  const e21 = ema(closes, 21).at(-1)!
  const e50 = ema(closes, 50).at(-1)!

  // EMA alignment: -1 fully bearish, +1 fully bullish
  const aligned =
    e9 > e21 && e21 > e50 ? 1 :
    e9 < e21 && e21 < e50 ? -1 :
    0
  const emaSep = (e9 - e50) / e50    // size of trend lead
  const emaScore = aligned * Math.min(Math.abs(emaSep) * 50, 1)

  // Momentum: 20-bar return
  const ret20 = (last - closes[closes.length - 20]!) / closes[closes.length - 20]!
  const momentum = Math.max(-1, Math.min(1, ret20 * 15))

  // RSI: distance from 50, signed
  const r = rsi(closes)
  const rsiScore = (r - 50) / 50

  // MACD histogram normalized
  const mh = macdHist(closes)
  const macdScore = Math.max(-1, Math.min(1, mh / (last * 0.002)))

  // Volatility (ATR percentile proxy)
  const recent = closes.slice(-20)
  const changes = recent.slice(1).map((v, i) => Math.abs(v - recent[i]!) / recent[i]!)
  const atrPct = changes.reduce((s, x) => s + x, 0) / changes.length
  const volScore = Math.max(-1, Math.min(1, (atrPct - 0.01) * 100))

  // Persistence (autocorrelation of last 20 returns)
  const rets = recent.slice(1).map((v, i) => (v - recent[i]!) / recent[i]!)
  let cov = 0, var0 = 0
  for (let i = 1; i < rets.length; i++) {
    cov  += rets[i]! * rets[i - 1]!
    var0 += rets[i - 1]! ** 2
  }
  const persistence = var0 > 0 ? Math.max(-1, Math.min(1, cov / var0)) : 0

  // Weighted blend → logit → probability of UP move
  const z =
    emaScore   * 1.4 +
    momentum   * 1.0 +
    rsiScore   * 0.6 +
    macdScore  * 1.0 +
    persistence * 0.8 -
    volScore   * 0.3

  const pUp = logistic(z * 1.5)
  const direction = pUp > 0.55 ? 'up' : pUp < 0.45 ? 'down' : 'neutral'
  const probability = Math.round((direction === 'down' ? 1 - pUp : pUp) * 100)

  const reasons: string[] = []
  if (Math.abs(emaScore) > 0.4) {
    reasons.push(`EMA stack ${emaScore > 0 ? 'bullish' : 'bearish'} aligned`)
  }
  if (Math.abs(momentum) > 0.3) {
    reasons.push(`Strong ${momentum > 0 ? 'upward' : 'downward'} 20-bar momentum`)
  }
  if (r >= 70)      reasons.push(`RSI ${Math.round(r)} — overbought, expect mean-reversion drag`)
  else if (r <= 30) reasons.push(`RSI ${Math.round(r)} — oversold, bounce-prone`)
  if (Math.abs(macdScore) > 0.4) reasons.push(`MACD histogram ${macdScore > 0 ? 'expanding up' : 'expanding down'}`)
  if (volScore > 0.5) reasons.push('High volatility — wider stops required')
  if (persistence > 0.3)      reasons.push('Returns auto-correlated (trending regime)')
  else if (persistence < -0.3) reasons.push('Negative auto-correlation (mean-reverting)')

  return {
    direction,
    probability,
    factors: {
      ema_alignment: emaScore,
      momentum,
      rsi_position:  rsiScore,
      macd_signal:   macdScore,
      volatility:    volScore,
      persistence,
    },
    reasons,
  }
}
