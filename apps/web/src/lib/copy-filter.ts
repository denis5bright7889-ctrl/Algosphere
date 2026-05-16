/**
 * Copy-Trading AI Filter Bot.
 *
 * Scores traders for copy-worthiness and flags statistical red flags:
 * single-trade dominance, unsustainable streaks, tiny samples,
 * drawdown/return mismatch, and gamed win-rate patterns.
 *
 * Pure functions over the metrics already cached in `trader_scores`
 * + journal aggregates. No I/O.
 */

export interface FilterInput {
  totalTrades:      number
  winRate:          number       // 0-1
  sharpeRatio:      number | null
  maxDrawdownPct:   number       // 0-1
  profitFactor:     number
  monthlyReturnPct: number
  largestWinPct?:   number       // % of total profit from single best trade
  consecutiveWins?: number
  followersCount:   number
  copyFollowersAvgReturn?: number | null
}

export type FilterFlag =
  | 'small_sample'
  | 'single_trade_dominance'
  | 'unsustainable_streak'
  | 'dd_return_mismatch'
  | 'low_profit_factor'
  | 'negative_follower_pnl'
  | 'gamed_winrate'

export interface FilterResult {
  trustScore:   number        // 0-100, higher = safer to copy
  verdict:      'recommended' | 'caution' | 'avoid'
  flags:        FilterFlag[]
  reasons:      string[]
}

const FLAG_REASON: Record<FilterFlag, string> = {
  small_sample:           'Fewer than 30 trades — statistically unreliable',
  single_trade_dominance: 'One trade accounts for an outsized share of profit',
  unsustainable_streak:   'Win streak length is statistically improbable',
  dd_return_mismatch:     'Returns inconsistent with drawdown profile (curve-fit risk)',
  low_profit_factor:      'Profit factor below 1.2 — thin edge',
  negative_follower_pnl:  'Existing copy followers are net negative',
  gamed_winrate:          'High win rate with poor profit factor (small wins, big losses)',
}

export function filterTrader(inp: FilterInput): FilterResult {
  const flags: FilterFlag[] = []

  if (inp.totalTrades < 30) flags.push('small_sample')

  if ((inp.largestWinPct ?? 0) > 0.40) flags.push('single_trade_dominance')

  // P(streak) ~ winRate^streak; flag if probability < 0.5%
  if (inp.consecutiveWins && inp.winRate > 0) {
    const p = Math.pow(inp.winRate, inp.consecutiveWins)
    if (p < 0.005 && inp.consecutiveWins >= 8) flags.push('unsustainable_streak')
  }

  // High return but suspiciously low drawdown → likely curve-fit / fake
  if (inp.monthlyReturnPct > 15 && inp.maxDrawdownPct < 0.03 && inp.totalTrades < 100) {
    flags.push('dd_return_mismatch')
  }

  if (inp.profitFactor < 1.2) flags.push('low_profit_factor')

  if (inp.copyFollowersAvgReturn != null && inp.copyFollowersAvgReturn < 0) {
    flags.push('negative_follower_pnl')
  }

  // Win rate > 70% but profit factor < 1.3 = many small wins, rare huge losses
  if (inp.winRate > 0.70 && inp.profitFactor < 1.3) flags.push('gamed_winrate')

  // ─── Trust score ───────────────────────────────────────────
  let score = 50

  // Sample size credibility (Bayesian-ish ramp)
  score += Math.min(inp.totalTrades / 4, 20)            // up to +20

  // Risk-adjusted quality
  const sharpe = inp.sharpeRatio ?? 0
  score += Math.min(Math.max(sharpe, 0) * 8, 20)        // up to +20

  // Profit factor
  score += Math.min((inp.profitFactor - 1) * 15, 15)    // up to +15

  // Drawdown control
  score += Math.max(0, (0.25 - inp.maxDrawdownPct) * 60) // up to +15

  // Follower validation
  if (inp.copyFollowersAvgReturn != null && inp.copyFollowersAvgReturn > 0) score += 10

  // Penalties per flag
  const PENALTY: Record<FilterFlag, number> = {
    small_sample:           18,
    single_trade_dominance: 25,
    unsustainable_streak:   20,
    dd_return_mismatch:     22,
    low_profit_factor:      15,
    negative_follower_pnl:  20,
    gamed_winrate:          18,
  }
  for (const f of flags) score -= PENALTY[f]

  score = Math.max(0, Math.min(100, Math.round(score)))

  const verdict: FilterResult['verdict'] =
    score >= 65 && flags.length === 0 ? 'recommended'
    : score >= 40 ? 'caution'
    : 'avoid'

  return {
    trustScore: score,
    verdict,
    flags,
    reasons: flags.map(f => FLAG_REASON[f]),
  }
}

export function verdictBadge(verdict: FilterResult['verdict']): {
  label: string; cls: string
} {
  switch (verdict) {
    case 'recommended':
      return { label: '✓ Copy-Safe', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' }
    case 'caution':
      return { label: '⚠ Caution', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' }
    default:
      return { label: '✕ Avoid', cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10' }
  }
}
