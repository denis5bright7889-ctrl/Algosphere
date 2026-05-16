/**
 * Strategy Backtesting Engine — deterministic replay over historical bars.
 *
 * Pure functions, no I/O. Takes OHLC bars + a rule config, simulates
 * entries/exits with fixed risk, returns full performance stats + equity curve.
 * Strategy templates mirror the live signal engine (EMA trend, RSI mean-revert).
 */

export interface Bar {
  time:  number    // unix seconds
  open:  number
  high:  number
  low:   number
  close: number
}

export type StrategyType = 'ema_trend' | 'rsi_reversion' | 'breakout'

export interface BacktestConfig {
  strategy:       StrategyType
  startingEquity: number
  riskPct:        number    // % equity risked per trade
  rrTarget:       number    // reward:risk multiple (e.g. 2 = 1:2)
  slAtrMult:      number    // stop = slAtrMult × ATR
  emaFast?:       number    // ema_trend
  emaSlow?:       number
  rsiPeriod?:     number    // rsi_reversion
  rsiOversold?:   number
  rsiOverbought?: number
  bbPeriod?:      number    // breakout
}

export interface BacktestTrade {
  entryTime: number
  exitTime:  number
  direction: 'long' | 'short'
  entry:     number
  exit:      number
  pnl:       number
  result:    'win' | 'loss'
}

export interface BacktestResult {
  trades:        BacktestTrade[]
  totalTrades:   number
  wins:          number
  losses:        number
  winRate:       number
  netPnl:        number
  netPnlPct:     number
  maxDrawdownPct: number
  sharpe:        number | null
  profitFactor:  number
  avgWin:        number
  avgLoss:       number
  equityCurve:   { time: number; equity: number }[]
}

// ─── Indicators (pure numpy-free) ────────────────────────────

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

function rsi(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(50)
  let gain = 0, loss = 0
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!
    const g = Math.max(diff, 0)
    const l = Math.max(-diff, 0)
    if (i <= period) {
      gain += g; loss += l
      if (i === period) {
        gain /= period; loss /= period
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
      }
    } else {
      gain = (gain * (period - 1) + g) / period
      loss = (loss * (period - 1) + l) / period
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
    }
  }
  return out
}

function atr(bars: Bar[], period = 14): number[] {
  const tr: number[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) { tr.push(bars[0]!.high - bars[0]!.low); continue }
    const b = bars[i]!, p = bars[i - 1]!
    tr.push(Math.max(
      b.high - b.low,
      Math.abs(b.high - p.close),
      Math.abs(b.low - p.close),
    ))
  }
  return ema(tr, period)
}

// ─── Backtest core ───────────────────────────────────────────

export function runBacktest(bars: Bar[], cfg: BacktestConfig): BacktestResult {
  const closes = bars.map(b => b.close)
  const atrArr = atr(bars, 14)

  const emaFast = ema(closes, cfg.emaFast ?? 9)
  const emaSlow = ema(closes, cfg.emaSlow ?? 21)
  const rsiArr  = rsi(closes, cfg.rsiPeriod ?? 14)

  const trades: BacktestTrade[] = []
  let equity = cfg.startingEquity
  let peak   = equity
  let maxDd  = 0
  const curve: { time: number; equity: number }[] = [{ time: bars[0]?.time ?? 0, equity }]

  let inPos = false
  let dir: 'long' | 'short' = 'long'
  let entryPrice = 0, stop = 0, target = 0, entryTime = 0, riskAmt = 0

  const warmup = Math.max(cfg.emaSlow ?? 21, cfg.rsiPeriod ?? 14, 14) + 1

  for (let i = warmup; i < bars.length; i++) {
    const b = bars[i]!
    const a = atrArr[i] || 0.0001

    if (inPos) {
      const hitStop   = dir === 'long' ? b.low  <= stop   : b.high >= stop
      const hitTarget = dir === 'long' ? b.high >= target : b.low  <= target
      if (hitStop || hitTarget) {
        const exit = hitStop ? stop : target
        const pnl  = dir === 'long'
          ? (exit - entryPrice) / (entryPrice - stop) * riskAmt
          : (entryPrice - exit) / (stop - entryPrice) * riskAmt
        equity += pnl
        trades.push({
          entryTime, exitTime: b.time, direction: dir,
          entry: entryPrice, exit, pnl,
          result: pnl >= 0 ? 'win' : 'loss',
        })
        peak  = Math.max(peak, equity)
        maxDd = Math.max(maxDd, (peak - equity) / peak)
        curve.push({ time: b.time, equity })
        inPos = false
      }
      continue
    }

    // Entry signals
    let signal: 'long' | 'short' | null = null
    if (cfg.strategy === 'ema_trend') {
      if (emaFast[i]! > emaSlow[i]! && emaFast[i - 1]! <= emaSlow[i - 1]!) signal = 'long'
      if (emaFast[i]! < emaSlow[i]! && emaFast[i - 1]! >= emaSlow[i - 1]!) signal = 'short'
    } else if (cfg.strategy === 'rsi_reversion') {
      const lo = cfg.rsiOversold ?? 30, hi = cfg.rsiOverbought ?? 70
      if (rsiArr[i]! < lo && rsiArr[i - 1]! >= lo) signal = 'long'
      if (rsiArr[i]! > hi && rsiArr[i - 1]! <= hi) signal = 'short'
    } else { // breakout
      const lookback = cfg.bbPeriod ?? 20
      const hh = Math.max(...closes.slice(i - lookback, i))
      const ll = Math.min(...closes.slice(i - lookback, i))
      if (b.close > hh) signal = 'long'
      if (b.close < ll) signal = 'short'
    }

    if (signal) {
      inPos = true
      dir = signal
      entryPrice = b.close
      entryTime  = b.time
      riskAmt    = equity * (cfg.riskPct / 100)
      const slDist = a * cfg.slAtrMult
      stop   = dir === 'long' ? entryPrice - slDist : entryPrice + slDist
      target = dir === 'long'
        ? entryPrice + slDist * cfg.rrTarget
        : entryPrice - slDist * cfg.rrTarget
    }
  }

  const wins   = trades.filter(t => t.result === 'win')
  const losses = trades.filter(t => t.result === 'loss')
  const grossWin  = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))

  // Sharpe on per-trade returns
  const rets = trades.map(t => t.pnl / cfg.startingEquity)
  const mean = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0
  const variance = rets.length > 1
    ? rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1)
    : 0
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : null

  return {
    trades,
    totalTrades:    trades.length,
    wins:           wins.length,
    losses:         losses.length,
    winRate:        trades.length ? Math.round(wins.length / trades.length * 1000) / 10 : 0,
    netPnl:         Math.round((equity - cfg.startingEquity) * 100) / 100,
    netPnlPct:      Math.round((equity - cfg.startingEquity) / cfg.startingEquity * 10000) / 100,
    maxDrawdownPct: Math.round(maxDd * 10000) / 100,
    sharpe:         sharpe != null ? Math.round(sharpe * 100) / 100 : null,
    profitFactor:   grossLoss > 0 ? Math.round(grossWin / grossLoss * 100) / 100 : grossWin > 0 ? 99 : 0,
    avgWin:         wins.length ? Math.round(grossWin / wins.length * 100) / 100 : 0,
    avgLoss:        losses.length ? Math.round(grossLoss / losses.length * 100) / 100 : 0,
    equityCurve:    curve,
  }
}

/** Synthetic bar generator for demo/no-data backtests (geometric brownian motion). */
export function syntheticBars(count: number, seed = 42, start = 100): Bar[] {
  let s = seed
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const bars: Bar[] = []
  let price = start
  let t = Math.floor(Date.now() / 1000) - count * 3600
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.48) * price * 0.02
    const open  = price
    const close = Math.max(1, price + drift)
    const high  = Math.max(open, close) * (1 + rand() * 0.005)
    const low   = Math.min(open, close) * (1 - rand() * 0.005)
    bars.push({ time: t, open, high, low, close })
    price = close
    t += 3600
  }
  return bars
}
