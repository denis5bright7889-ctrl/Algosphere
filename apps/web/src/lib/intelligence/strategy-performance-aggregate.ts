/**
 * Strategy Performance aggregator — Phase 5 of the Validation Center.
 *
 * Pure function: takes shadow-execution rows pre-joined with their
 * strategy attribution + execution outcomes, groups by strategy,
 * computes ten institutional metrics per strategy, then derives four
 * ranking tables (top / worst / consistent / risky).
 *
 * The 3-hop join required to attribute a shadow row to a strategy
 * (shadow_executions → copy_trades → strategy_subscriptions →
 * published_strategies) is performed by the caller — this module
 * stays pure so it can be unit-tested and reused elsewhere.
 *
 * Honesty contract:
 *   - MIN_SAMPLE per strategy = 10. Below that, all outcome metrics
 *     return null and the strategy carries a "collecting_data" flag
 *     (UI shows a pill, no numbers).
 *   - Rankings are only generated when ≥2 strategies are above the
 *     sample threshold — a one-strategy "leaderboard" is dishonest.
 *   - Metrics that can't be computed (e.g. profit factor with zero
 *     losses, calmar with zero drawdown) return null, NEVER ∞.
 *   - All grading uses public methodology disclosed in the UI footer.
 */

export const STRATEGY_MIN_SAMPLE = 10
const ROLLING_WIN_WINDOW = 30
const TRADING_DAYS_PER_YEAR = 252

export interface StrategyShadowRow {
  strategy_id:    string
  strategy_name:  string
  follower_pnl:   number | null
  closed_at:      string | null
  created_at:     string
  actual_status:  string
  slippage_pct:   number | null
  pnl_drift_pct:  number | null
}

export interface StrategyMetrics {
  strategy_id:        string
  strategy_name:      string
  sample_size:        number
  closed_count:       number
  collecting_data:    boolean        // true when closed < STRATEGY_MIN_SAMPLE

  win_rate_pct:       number | null
  profit_factor:      number | null
  sharpe:             number | null
  sortino:            number | null
  expectancy:         number | null   // per-trade mean PnL
  avg_holding_hours:  number | null
  max_drawdown:       number | null
  recovery_factor:    number | null
  /** Composite 0-100: low PnL stddev + low drawdown + high R-multiple. */
  risk_score:         number | null
  /** Composite 0-100: derived from sample-size, win-rate, profit-factor. */
  confidence_score:   number | null
  /** Cumulative net P&L. */
  net_pnl:            number | null
}

export interface StrategyRanking {
  category:  'top' | 'worst' | 'consistent' | 'risky'
  /** Display label for the ranking table header. */
  label:     string
  /** Sub-label explaining the ranking criterion. */
  criterion: string
  entries:   Array<{
    strategy_id:   string
    strategy_name: string
    score:         number
  }>
}

export interface StrategyPerformanceReport {
  strategies: StrategyMetrics[]
  rankings:   StrategyRanking[]
  /** True when there were 0 attributed shadow rows. */
  empty:      boolean
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

function maxDrawdown(pnls: number[]): number {
  let peak = 0, run = 0, maxDD = 0
  for (const p of pnls) {
    run += p
    if (run > peak) peak = run
    if (peak - run > maxDD) maxDD = peak - run
  }
  return maxDD
}

function computeOne(group: StrategyShadowRow[]): StrategyMetrics {
  const sampleSize = group.length
  const closed = group.filter(r => r.closed_at && typeof r.follower_pnl === 'number')
  const closedCount = closed.length

  const base: StrategyMetrics = {
    strategy_id:       group[0]!.strategy_id,
    strategy_name:     group[0]!.strategy_name,
    sample_size:       sampleSize,
    closed_count:      closedCount,
    collecting_data:   closedCount < STRATEGY_MIN_SAMPLE,
    win_rate_pct:      null,
    profit_factor:     null,
    sharpe:            null,
    sortino:           null,
    expectancy:        null,
    avg_holding_hours: null,
    max_drawdown:      null,
    recovery_factor:   null,
    risk_score:        null,
    confidence_score:  null,
    net_pnl:           null,
  }

  if (closedCount < STRATEGY_MIN_SAMPLE) return base

  const pnls    = closed.map(r => r.follower_pnl as number)
  const winners = pnls.filter(p => p > 0)
  const losers  = pnls.filter(p => p < 0)
  const grossWins   = winners.reduce((a, b) => a + b, 0)
  const grossLosses = Math.abs(losers.reduce((a, b) => a + b, 0))
  const netPnl      = grossWins - grossLosses

  const winRate = Math.round((winners.length / closedCount) * 100)
  const profitFactor = grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : null

  const muPer = mean(pnls)
  const sdPer = stdev(pnls)
  const sdDown = stdev(pnls.filter(p => p < 0))
  const sharpe = sdPer > 0
    ? Math.round((muPer / sdPer) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100) / 100
    : null
  const sortino = sdDown > 0
    ? Math.round((muPer / sdDown) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100) / 100
    : null

  const dd = maxDrawdown(pnls)
  const recovery = dd > 0 ? Math.round((netPnl / dd) * 100) / 100 : null

  // Avg holding hours from created_at → closed_at.
  const holdings: number[] = []
  for (const r of closed) {
    if (!r.closed_at) continue
    const open  = new Date(r.created_at).getTime()
    const close = new Date(r.closed_at).getTime()
    if (close > open) holdings.push((close - open) / 3_600_000)
  }
  const avgHold = holdings.length > 0
    ? Math.round(mean(holdings) * 10) / 10
    : null

  // Risk score (0-100): low PnL stddev + low drawdown + positive
  // expectancy → high score. Composite of three normalised terms.
  //   • stddev term: clamp(1 - sdPer / (|muPer| + sdPer), 0, 1)
  //   • drawdown term: clamp(1 - dd / (netPnl + dd), 0, 1)
  //   • expectancy term: clamp(muPer / (|muPer| + 5), -1, 1) → [0,1]
  const sdTerm   = (Math.abs(muPer) + sdPer) > 0
    ? Math.max(0, Math.min(1, 1 - sdPer / (Math.abs(muPer) + sdPer)))
    : 0
  const ddTerm   = (Math.abs(netPnl) + dd) > 0
    ? Math.max(0, Math.min(1, 1 - dd / (Math.abs(netPnl) + dd)))
    : 0
  const expTerm  = Math.max(0, Math.min(1, (muPer / (Math.abs(muPer) + 5) + 1) / 2))
  const riskScore = Math.round((sdTerm * 0.4 + ddTerm * 0.35 + expTerm * 0.25) * 100)

  // Confidence score (0-100): sample-size-weighted PF + win-rate.
  //   • sample term: clamp(closedCount / 50, 0, 1)
  //   • PF term:     clamp(PF / 2, 0, 1)
  //   • wr term:     clamp((winRate - 40) / 30, 0, 1)
  const sampleTerm = Math.max(0, Math.min(1, closedCount / 50))
  const pfTerm     = profitFactor == null ? 0 : Math.max(0, Math.min(1, profitFactor / 2))
  const wrTerm     = Math.max(0, Math.min(1, (winRate - 40) / 30))
  const confScore  = Math.round((sampleTerm * 0.35 + pfTerm * 0.40 + wrTerm * 0.25) * 100)

  return {
    ...base,
    win_rate_pct:      winRate,
    profit_factor:     profitFactor,
    sharpe,
    sortino,
    expectancy:        Math.round(muPer * 100) / 100,
    avg_holding_hours: avgHold,
    max_drawdown:      Math.round(dd * 100) / 100,
    recovery_factor:   recovery,
    risk_score:        riskScore,
    confidence_score:  confScore,
    net_pnl:           Math.round(netPnl * 100) / 100,
  }
}

export function aggregateStrategyPerformance(
  rows: StrategyShadowRow[],
): StrategyPerformanceReport {
  if (rows.length === 0) {
    return { strategies: [], rankings: [], empty: true }
  }

  // Group rows by strategy_id.
  const byStrat = new Map<string, StrategyShadowRow[]>()
  for (const r of rows) {
    if (!r.strategy_id) continue   // unattributed rows are ignored
    const list = byStrat.get(r.strategy_id) ?? []
    list.push(r)
    byStrat.set(r.strategy_id, list)
  }

  const strategies: StrategyMetrics[] = []
  for (const group of byStrat.values()) {
    strategies.push(computeOne(group))
  }

  // Rankings only when ≥2 strategies are above the sample threshold —
  // one-strategy leaderboards are dishonest.
  const graded = strategies.filter(s => !s.collecting_data)
  const rankings: StrategyRanking[] = []
  if (graded.length >= 2) {
    const rank = (
      category:  StrategyRanking['category'],
      label:     string,
      criterion: string,
      sortFn:    (a: StrategyMetrics, b: StrategyMetrics) => number,
      scoreFn:   (s: StrategyMetrics) => number,
    ) => {
      const sorted = [...graded].sort(sortFn)
      rankings.push({
        category, label, criterion,
        entries: sorted.slice(0, 5).map(s => ({
          strategy_id:   s.strategy_id,
          strategy_name: s.strategy_name,
          score:         Math.round(scoreFn(s) * 100) / 100,
        })),
      })
    }

    // Top: highest net P&L
    rank('top', 'Top Performing', 'by net P&L (closed)',
      (a, b) => (b.net_pnl ?? 0) - (a.net_pnl ?? 0),
      s => s.net_pnl ?? 0)

    // Worst: lowest net P&L (or most negative)
    rank('worst', 'Worst Performing', 'by net P&L (closed)',
      (a, b) => (a.net_pnl ?? 0) - (b.net_pnl ?? 0),
      s => s.net_pnl ?? 0)

    // Most consistent: highest Sharpe (return per unit volatility)
    rank('consistent', 'Most Consistent', 'by Sharpe ratio',
      (a, b) => (b.sharpe ?? -999) - (a.sharpe ?? -999),
      s => s.sharpe ?? 0)

    // Highest risk: highest drawdown / lowest risk_score
    rank('risky', 'Highest Risk', 'by max drawdown',
      (a, b) => (b.max_drawdown ?? 0) - (a.max_drawdown ?? 0),
      s => s.max_drawdown ?? 0)
  }

  // Default sort for the main table: net P&L desc, then sample desc.
  strategies.sort((a, b) => {
    const ap = a.net_pnl ?? -Infinity
    const bp = b.net_pnl ?? -Infinity
    if (ap !== bp) return bp - ap
    return b.sample_size - a.sample_size
  })

  return { strategies, rankings, empty: false }
}

void ROLLING_WIN_WINDOW   // reserved for Phase 6+ rolling overlay
