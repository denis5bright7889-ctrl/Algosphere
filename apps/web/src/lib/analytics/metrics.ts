// =============================================================================
// AlgoSphere Quant — Institutional Performance Metrics
// Sharpe, Sortino, Max Drawdown, Calmar, Expectancy, Profit Factor
// =============================================================================

import type { PerformanceMetrics, DrawdownPoint } from '@/lib/types'

const ANNUALISATION = Math.sqrt(252) // daily → annual
const RISK_FREE_RATE = 0             // assume 0 for trading context

export function computeMetrics(pnlSeries: number[]): PerformanceMetrics {
  if (pnlSeries.length === 0) return emptyMetrics()

  const wins = pnlSeries.filter(p => p > 0)
  const losses = pnlSeries.filter(p => p < 0)
  const totalPnl = pnlSeries.reduce((a, b) => a + b, 0)
  const winRate = pnlSeries.length ? wins.length / pnlSeries.length : 0
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0

  const sharpe = computeSharpe(pnlSeries)
  const sortino = computeSortino(pnlSeries)
  const { maxDrawdownPct, maxDrawdownUsd } = computeMaxDrawdown(pnlSeries)
  const profitFactor = losses.length
    ? Math.abs(wins.reduce((a, b) => a + b, 0)) / Math.abs(losses.reduce((a, b) => a + b, 0))
    : wins.length > 0 ? Infinity : 0

  const calmar = maxDrawdownPct > 0
    ? (totalPnl / pnlSeries.length * 252) / (maxDrawdownPct * 100)
    : 0

  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss

  const consecutive = computeConsecutive(pnlSeries)

  return {
    sharpe_ratio: round(sharpe, 2),
    sortino_ratio: round(sortino, 2),
    max_drawdown_pct: round(maxDrawdownPct * 100, 2),
    max_drawdown_usd: round(maxDrawdownUsd, 2),
    calmar_ratio: round(calmar, 2),
    expectancy: round(expectancy, 2),
    profit_factor: round(profitFactor, 2),
    avg_win: round(avgWin, 2),
    avg_loss: round(avgLoss, 2),
    win_rate: round(winRate * 100, 1),
    total_trades: pnlSeries.length,
    total_pnl: round(totalPnl, 2),
    best_trade: round(Math.max(...pnlSeries), 2),
    worst_trade: round(Math.min(...pnlSeries), 2),
    consecutive_wins: consecutive.maxWins,
    consecutive_losses: consecutive.maxLosses,
  }
}

function computeSharpe(series: number[]): number {
  const mean = series.reduce((a, b) => a + b, 0) / series.length - RISK_FREE_RATE
  const variance = series.reduce((a, b) => a + Math.pow(b - mean + RISK_FREE_RATE, 2), 0) / series.length
  const std = Math.sqrt(variance)
  return std === 0 ? 0 : (mean / std) * ANNUALISATION
}

function computeSortino(series: number[]): number {
  const mean = series.reduce((a, b) => a + b, 0) / series.length - RISK_FREE_RATE
  const downside = series.filter(r => r < 0)
  if (downside.length === 0) return mean > 0 ? 99.99 : 0
  const downsideVariance = downside.reduce((a, b) => a + Math.pow(b, 2), 0) / downside.length
  const downsideStd = Math.sqrt(downsideVariance)
  return downsideStd === 0 ? 0 : (mean / downsideStd) * ANNUALISATION
}

function computeMaxDrawdown(series: number[]): { maxDrawdownPct: number; maxDrawdownUsd: number } {
  let peak = 0
  let cumulative = 0
  let maxDrawdownPct = 0
  let maxDrawdownUsd = 0

  for (const pnl of series) {
    cumulative += pnl
    if (cumulative > peak) peak = cumulative
    const ddUsd = peak - cumulative
    const ddPct = peak > 0 ? ddUsd / peak : 0
    if (ddPct > maxDrawdownPct) {
      maxDrawdownPct = ddPct
      maxDrawdownUsd = ddUsd
    }
  }
  return { maxDrawdownPct, maxDrawdownUsd }
}

export function computeDrawdownCurve(
  series: { date: string; pnl: number }[]
): DrawdownPoint[] {
  let peak = 0
  let cumulative = 0
  return series.map(({ date, pnl }) => {
    cumulative += pnl
    if (cumulative > peak) peak = cumulative
    const drawdown_pct = peak > 0 ? -((peak - cumulative) / peak) * 100 : 0
    return { date, equity: round(cumulative, 2), drawdown_pct: round(drawdown_pct, 2) }
  })
}

function computeConsecutive(series: number[]): { maxWins: number; maxLosses: number } {
  let maxWins = 0
  let maxLosses = 0
  let curWins = 0
  let curLosses = 0

  for (const p of series) {
    if (p > 0) {
      curWins++
      curLosses = 0
    } else if (p < 0) {
      curLosses++
      curWins = 0
    } else {
      curWins = 0
      curLosses = 0
    }
    if (curWins > maxWins) maxWins = curWins
    if (curLosses > maxLosses) maxLosses = curLosses
  }
  return { maxWins, maxLosses }
}

function emptyMetrics(): PerformanceMetrics {
  return {
    sharpe_ratio: 0, sortino_ratio: 0,
    max_drawdown_pct: 0, max_drawdown_usd: 0,
    calmar_ratio: 0, expectancy: 0, profit_factor: 0,
    avg_win: 0, avg_loss: 0, win_rate: 0, total_trades: 0,
    total_pnl: 0, best_trade: 0, worst_trade: 0,
    consecutive_wins: 0, consecutive_losses: 0,
  }
}

function round(n: number, dp: number): number {
  const factor = Math.pow(10, dp)
  return Math.round(n * factor) / factor
}

// Interpret Sharpe for UI display
export function interpretSharpe(ratio: number): { label: string; color: string } {
  if (ratio >= 2.0) return { label: 'Excellent', color: 'text-emerald-600' }
  if (ratio >= 1.5) return { label: 'Very Good', color: 'text-green-600' }
  if (ratio >= 1.0) return { label: 'Good', color: 'text-blue-600' }
  if (ratio >= 0.5) return { label: 'Acceptable', color: 'text-yellow-600' }
  if (ratio >= 0)   return { label: 'Weak', color: 'text-orange-600' }
  return { label: 'Negative', color: 'text-red-600' }
}
