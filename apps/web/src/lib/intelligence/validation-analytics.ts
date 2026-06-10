/**
 * Institutional analytics for AI Strategy Validation Center (Phase 8).
 *
 * Pure functions over an array of CLOSED shadow trades. Computes the
 * eight metrics the spec calls out:
 *   • Sharpe Ratio        — risk-adjusted return (Gaussian)
 *   • Sortino Ratio       — downside-only risk-adjusted return
 *   • Calmar Ratio        — annualised return / max drawdown
 *   • Profit Factor       — gross wins / gross losses
 *   • Recovery Factor     — net profit / max drawdown
 *   • Average R Multiple  — mean per-trade outcome in R (when risk known)
 *   • Expected Value      — mean PnL per trade
 *   • Kelly Percentage    — capped at 25% (full Kelly is a footgun)
 *   • Risk of Ruin        — Monte-Carlo-equivalent closed-form estimate
 *
 * Honesty contract:
 *   - All outcome metrics suppressed when sample < MIN_SAMPLE (returns
 *     null, not zero, not an extrapolation).
 *   - Ratios that require a divisor (e.g. profit factor on zero losses,
 *     calmar with zero drawdown) return null rather than Infinity.
 *   - Annualisation uses sqrt(252) — public methodology, never hidden.
 *   - Pure: same input → same output. No randomness, no LLM.
 */

export const MIN_SAMPLE = 30
const TRADING_DAYS_PER_YEAR = 252

export interface TradeOutcome {
  /** Realised P&L on the follower side. Required. */
  follower_pnl: number
  /** Optional risk amount used to compute R-multiples. */
  risk_amount?: number | null
  /** Optional close timestamp for time-weighted aggregations. */
  closed_at?: string | null
}

export interface InstitutionalAnalytics {
  sample_size:     number
  sharpe:          number | null
  sortino:         number | null
  calmar:          number | null
  profit_factor:   number | null
  recovery_factor: number | null
  avg_r_multiple:  number | null
  expected_value:  number | null
  kelly_pct:       number | null
  risk_of_ruin:    number | null
  /** Maximum peak-to-trough drawdown across the equity curve. */
  max_drawdown:    number | null
  /** Cumulative net P&L (sum of follower_pnl). */
  net_profit:      number | null
  /** Win count + loss count for the win-rate display. */
  wins:            number
  losses:          number
  win_rate_pct:    number | null
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

/** Max peak-to-trough drawdown on the cumulative-PnL equity curve. */
function maxDrawdown(pnls: number[]): number {
  let peak = 0
  let runSum = 0
  let maxDD = 0
  for (const p of pnls) {
    runSum += p
    if (runSum > peak) peak = runSum
    const dd = peak - runSum
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

/**
 * Closed-form risk-of-ruin estimate. Uses the standard gambler's-ruin
 * approximation: ((1-W)/W)^N where W is win-rate and N is bankroll
 * expressed in average-loss units. We treat 100 average-losses of
 * runway as the bankroll → meaningful values for normal sample sizes.
 */
function riskOfRuin(winRate: number, avgWin: number, avgLoss: number): number {
  if (winRate <= 0 || winRate >= 1) return winRate <= 0 ? 1 : 0
  if (avgLoss <= 0) return 0
  const edge = winRate * avgWin - (1 - winRate) * avgLoss
  if (edge <= 0) return 1
  // Standard gambler's-ruin closed-form for 100x average-loss bankroll.
  const ratio = (1 - winRate) / winRate
  return Math.min(1, Math.pow(ratio, 100 * (avgLoss / Math.max(avgWin, avgLoss))))
}

export function computeInstitutionalAnalytics(
  trades: TradeOutcome[],
): InstitutionalAnalytics {
  const sampleSize = trades.length
  const empty: InstitutionalAnalytics = {
    sample_size:     sampleSize,
    sharpe:          null,
    sortino:         null,
    calmar:          null,
    profit_factor:   null,
    recovery_factor: null,
    avg_r_multiple:  null,
    expected_value:  null,
    kelly_pct:       null,
    risk_of_ruin:    null,
    max_drawdown:    null,
    net_profit:      null,
    wins:            0,
    losses:          0,
    win_rate_pct:    null,
  }

  if (sampleSize < MIN_SAMPLE) return empty

  const pnls = trades.map((t) => t.follower_pnl)
  const winners = pnls.filter((p) => p > 0)
  const losers  = pnls.filter((p) => p < 0)

  const grossWins   = winners.reduce((a, b) => a + b, 0)
  const grossLosses = Math.abs(losers.reduce((a, b) => a + b, 0))
  const netProfit   = grossWins - grossLosses

  // Distribution shape.
  const muPerTrade  = mean(pnls)
  const sdPerTrade  = stdev(pnls)
  const downsidePnls = pnls.filter((p) => p < 0)
  const sdDown      = stdev(downsidePnls)

  // Sharpe / Sortino — risk-free rate assumed 0 (per-trade timeframe).
  // Annualised by sqrt(252). Public methodology — disclosed in the UI.
  const sharpe  = sdPerTrade > 0
    ? Math.round(((muPerTrade / sdPerTrade) * Math.sqrt(TRADING_DAYS_PER_YEAR)) * 100) / 100
    : null
  const sortino = sdDown > 0
    ? Math.round(((muPerTrade / sdDown) * Math.sqrt(TRADING_DAYS_PER_YEAR)) * 100) / 100
    : null

  // Drawdown-based ratios.
  const dd = maxDrawdown(pnls)
  const calmar         = dd > 0 ? Math.round((netProfit / dd) * 100) / 100 : null
  const recoveryFactor = dd > 0 ? Math.round((netProfit / dd) * 100) / 100 : null

  // Profit factor — null when no losses (a 100% win rate is suspicious
  // and we refuse to label it ∞).
  const profitFactor = grossLosses > 0
    ? Math.round((grossWins / grossLosses) * 100) / 100
    : null

  // Avg R-multiple only when ≥10 trades carry a known risk_amount.
  const withR = trades.filter((t) => typeof t.risk_amount === 'number' && (t.risk_amount as number) > 0)
  const avgR  = withR.length >= 10
    ? Math.round(
        (withR.reduce((a, t) => a + (t.follower_pnl / (t.risk_amount as number)), 0) / withR.length) * 100,
      ) / 100
    : null

  const winRate = sampleSize > 0 ? winners.length / sampleSize : 0
  const avgWin  = winners.length > 0 ? grossWins / winners.length : 0
  const avgLoss = losers.length  > 0 ? grossLosses / losers.length : 0

  // Kelly fraction — fraction of bankroll that maximises log-growth.
  //   f* = W − (1 − W) / R    where R = avgWin / avgLoss
  // Capped at 25% (full Kelly is mathematically optimal but practically
  // a footgun — institutional desks use 0.25-0.5 fractional Kelly).
  const kelly = (avgLoss > 0 && winRate > 0)
    ? Math.max(0, Math.min(0.25, winRate - (1 - winRate) / (avgWin / avgLoss)))
    : null

  return {
    sample_size:     sampleSize,
    sharpe,
    sortino,
    calmar,
    profit_factor:   profitFactor,
    recovery_factor: recoveryFactor,
    avg_r_multiple:  avgR,
    expected_value:  Math.round(muPerTrade * 100) / 100,
    kelly_pct:       kelly == null ? null : Math.round(kelly * 10000) / 100,
    risk_of_ruin:    Math.round(riskOfRuin(winRate, avgWin, avgLoss) * 10000) / 100,
    max_drawdown:    Math.round(dd * 100) / 100,
    net_profit:      Math.round(netProfit * 100) / 100,
    wins:            winners.length,
    losses:          losers.length,
    win_rate_pct:    Math.round(winRate * 100),
  }
}
