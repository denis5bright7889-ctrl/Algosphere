/**
 * Trader Scoring Engine — 9-factor composite score (0–1000).
 *
 * Populates the `trader_scores` table from `journal_entries` aggregates.
 * Runs server-side via the service-role client. Triggered manually via
 * /api/admin/trader-scores/recompute or on-demand by Celery Beat.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const WEIGHTS = {
  win_rate:      0.25,
  risk_adjusted: 0.20,
  consistency:   0.15,
  drawdown:      0.15,
  sample_size:   0.10,
  recency:       0.05,
  diversity:     0.05,
  follower_pnl:  0.03,
  verification:  0.02,
} as const

const MAX_RATING  = 1000
const MIN_RATING  = 0

// ─── Component scorers (each returns 0–100) ───────────────────────────

export function scoreWinRate(winRate: number, totalTrades: number): number {
  // Bayesian shrinkage toward 0.5 (matches legacy formula)
  const shrinkage = totalTrades / (totalTrades + 20)
  const adjusted  = winRate * shrinkage + 0.5 * (1 - shrinkage)
  // Map: 40% = 0, 75%+ = 100
  return Math.max(0, Math.min(100, (adjusted - 0.40) / 0.35 * 100))
}

export function scoreRiskAdjusted(sharpe: number | null, sortino: number | null): number {
  const s    = Math.min(Math.max(sharpe  ?? 0, 0), 3.0)
  const sor  = Math.min(Math.max(sortino ?? 0, 0), 4.0)
  return (s / 3.0 * 100) * 0.60 + (sor / 4.0 * 100) * 0.40
}

export function scoreConsistency(monthlyReturns: number[]): number {
  if (monthlyReturns.length < 3) return 50
  const mu    = monthlyReturns.reduce((s, x) => s + x, 0) / monthlyReturns.length
  if (Math.abs(mu) < 0.001) return 30
  const variance = monthlyReturns
    .reduce((s, x) => s + (x - mu) ** 2, 0) / (monthlyReturns.length - 1)
  const sigma = Math.sqrt(variance)
  const cv = sigma / Math.abs(mu)        // coefficient of variation
  // CV 0.5 → 80 pts, CV 2.0 → 20 pts
  return Math.max(0, Math.min(100, 100 - cv * 40))
}

export function scoreDrawdown(maxDdPct: number): number {
  // 0% DD = 100, 30%+ = 0
  const dd = Math.abs(maxDdPct)
  return Math.max(0, Math.min(100, (1 - dd / 0.30) * 100))
}

export function scoreSampleSize(totalTrades: number): number {
  if (totalTrades < 5) return 0
  // 5 trades = 20pts, 50+ trades = 100pts (log scale)
  return Math.min(100, Math.log10(totalTrades / 5) / Math.log10(20) * 100)
}

export function scoreRecency(daysSinceLastTrade: number): number {
  // Active today = 100, idle 90d+ = 0
  return Math.max(0, Math.min(100, (1 - daysSinceLastTrade / 90) * 100))
}

export function scoreDiversity(uniquePairs: number, uniqueAssetClasses: number): number {
  const pairScore  = Math.min(uniquePairs / 5, 1) * 70
  const classScore = Math.min(uniqueAssetClasses / 3, 1) * 30
  return pairScore + classScore
}

export function scoreFollowerPnl(avgFollowerReturn: number | null): number {
  if (avgFollowerReturn == null || avgFollowerReturn === 0) return 50
  // +5% monthly = 100pts (saturates)
  return Math.max(0, Math.min(100, (avgFollowerReturn / 0.05) * 100))
}

export function scoreVerification(tier: string): number {
  return ({ none: 0, basic: 25, verified: 65, elite: 100 } as const)[tier as 'none'] ?? 0
}

// ─── Risk score (separate from composite, used for warnings) ─────────

export function computeRiskScore(args: {
  maxDdPct:      number
  winRate:       number
  totalTrades:   number
  sharpeRatio:   number | null
  profitFactor:  number
}): { score: number; label: 'low' | 'medium' | 'high' | 'extreme' } {
  let risk = 0
  if (args.maxDdPct > 0.20)        risk += 30
  else if (args.maxDdPct > 0.10)   risk += 15
  if (args.winRate < 0.45)         risk += 20
  if (args.totalTrades < 20)       risk += 20
  if ((args.sharpeRatio ?? 0) < 0.5) risk += 15
  if (args.profitFactor < 1.2)     risk += 15
  risk = Math.min(risk, 100)

  const label =
    risk < 25 ? 'low'
    : risk < 50 ? 'medium'
    : risk < 75 ? 'high'
    : 'extreme'
  return { score: risk, label }
}

// ─── Trade aggregation from journal_entries ──────────────────────────

interface TraderAggregates {
  userId:              string
  totalTrades:         number
  winningTrades:       number
  winRate:             number             // 0-1
  monthlyReturns:      number[]
  maxDrawdownPct:      number
  sharpeRatio:         number | null
  sortinoRatio:        number | null
  profitFactor:        number
  totalPnl:            number
  monthlyReturnPct:    number             // last 30 days
  allTimeReturnPct:    number
  uniquePairs:         number
  uniqueAssetClasses:  number
  daysSinceLastTrade:  number
}

function classifyAsset(pair: string): string {
  if (pair.startsWith('XAU') || pair.startsWith('XAG')) return 'metal'
  if (pair.startsWith('BTC') || pair.startsWith('ETH') || pair.endsWith('USDT'))
    return 'crypto'
  if (pair.startsWith('US') || pair.startsWith('NAS') || pair.startsWith('SPX'))
    return 'index'
  if (pair.startsWith('USOIL') || pair.startsWith('WTI')) return 'commodity'
  return 'forex'
}

export async function computeTraderAggregates(
  db: SupabaseClient,
  userId: string,
): Promise<TraderAggregates | null> {
  const { data: trades } = await db
    .from('journal_entries')
    .select('pnl, pair, trade_date, created_at')
    .eq('user_id', userId)
    .not('pnl', 'is', null)
    .order('trade_date', { ascending: true })

  if (!trades || trades.length === 0) return null

  const pnls   = trades.map(t => Number(t.pnl ?? 0))
  const totalTrades  = trades.length
  const winningTrades = pnls.filter(p => p > 0).length
  const winRate = winningTrades / totalTrades
  const totalPnl = pnls.reduce((s, p) => s + p, 0)

  // Monthly returns from cumulative pnl by YYYY-MM bucket
  const monthMap = new Map<string, number>()
  for (const t of trades) {
    const month = (t.trade_date as string).slice(0, 7)   // YYYY-MM
    monthMap.set(month, (monthMap.get(month) ?? 0) + Number(t.pnl ?? 0))
  }
  // Normalize to % using starting equity of $10k baseline
  const STARTING_EQUITY = 10_000
  const monthlyReturns = Array.from(monthMap.values()).map(p => p / STARTING_EQUITY)

  // Cumulative + drawdown
  let peak = STARTING_EQUITY
  let maxDdPct = 0
  let equity = STARTING_EQUITY
  for (const p of pnls) {
    equity += p
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak
    if (dd > maxDdPct) maxDdPct = dd
  }

  // Sharpe / Sortino on per-trade returns (annualized assuming ~252 trading days)
  const returns = pnls.map(p => p / STARTING_EQUITY)
  const mean    = returns.reduce((s, x) => s + x, 0) / returns.length
  const variance = returns.length > 1
    ? returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1)
    : 0
  const stdDev = Math.sqrt(variance)
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : null

  const downside = returns.filter(r => r < 0)
  const downsideStd = downside.length > 0
    ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length)
    : 0
  const sortinoRatio = downsideStd > 0 ? (mean / downsideStd) * Math.sqrt(252) : null

  // Profit factor
  const wins    = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0)
  const losses  = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0))
  const profitFactor = losses > 0 ? wins / losses : (wins > 0 ? 99 : 0)

  // Asset diversity
  const pairs        = new Set(trades.map(t => t.pair as string))
  const assetClasses = new Set(Array.from(pairs).map(classifyAsset))

  // Recency
  const lastTradeDate = trades[trades.length - 1]?.trade_date as string
  const daysSinceLastTrade = lastTradeDate
    ? Math.floor((Date.now() - new Date(lastTradeDate).getTime()) / 86_400_000)
    : 999

  // Monthly return: last 30 days
  const cutoff30d = new Date(Date.now() - 30 * 86_400_000)
  const monthly30 = trades
    .filter(t => new Date(t.trade_date as string) >= cutoff30d)
    .reduce((s, t) => s + Number(t.pnl ?? 0), 0) / STARTING_EQUITY

  return {
    userId,
    totalTrades,
    winningTrades,
    winRate,
    monthlyReturns,
    maxDrawdownPct:     maxDdPct,
    sharpeRatio,
    sortinoRatio,
    profitFactor,
    totalPnl,
    monthlyReturnPct:   monthly30 * 100,
    allTimeReturnPct:   (totalPnl / STARTING_EQUITY) * 100,
    uniquePairs:        pairs.size,
    uniqueAssetClasses: assetClasses.size,
    daysSinceLastTrade,
  }
}

// ─── Composite score calculator ──────────────────────────────────────

export function calculateCompositeScore(
  agg: TraderAggregates,
  verificationTier: string,
  avgFollowerReturn: number | null,
): {
  composite_score:      number
  score_win_rate:       number
  score_risk_adj:       number
  score_consistency:    number
  score_drawdown:       number
  score_sample_size:    number
  score_recency:        number
  score_diversity:      number
  score_follower_pnl:   number
  score_verification:   number
} {
  const components = {
    win_rate:      scoreWinRate(agg.winRate, agg.totalTrades),
    risk_adjusted: scoreRiskAdjusted(agg.sharpeRatio, agg.sortinoRatio),
    consistency:   scoreConsistency(agg.monthlyReturns),
    drawdown:      scoreDrawdown(agg.maxDrawdownPct),
    sample_size:   scoreSampleSize(agg.totalTrades),
    recency:       scoreRecency(agg.daysSinceLastTrade),
    diversity:     scoreDiversity(agg.uniquePairs, agg.uniqueAssetClasses),
    follower_pnl:  scoreFollowerPnl(avgFollowerReturn),
    verification:  scoreVerification(verificationTier),
  }

  const weighted =
    components.win_rate      * WEIGHTS.win_rate +
    components.risk_adjusted * WEIGHTS.risk_adjusted +
    components.consistency   * WEIGHTS.consistency +
    components.drawdown      * WEIGHTS.drawdown +
    components.sample_size   * WEIGHTS.sample_size +
    components.recency       * WEIGHTS.recency +
    components.diversity     * WEIGHTS.diversity +
    components.follower_pnl  * WEIGHTS.follower_pnl +
    components.verification  * WEIGHTS.verification

  // Bayesian pull toward 500 for small samples
  const credibility = Math.min(agg.totalTrades / 50, 1)
  const composite01 = weighted * credibility + 50 * (1 - credibility)
  const rating = MIN_RATING + composite01 / 100 * (MAX_RATING - MIN_RATING)

  return {
    composite_score:    Math.round(rating * 100) / 100,
    score_win_rate:     Math.round(components.win_rate * 100) / 100,
    score_risk_adj:     Math.round(components.risk_adjusted * 100) / 100,
    score_consistency:  Math.round(components.consistency * 100) / 100,
    score_drawdown:     Math.round(components.drawdown * 100) / 100,
    score_sample_size:  Math.round(components.sample_size * 100) / 100,
    score_recency:      Math.round(components.recency * 100) / 100,
    score_diversity:    Math.round(components.diversity * 100) / 100,
    score_follower_pnl: Math.round(components.follower_pnl * 100) / 100,
    score_verification: Math.round(components.verification * 100) / 100,
  }
}

// ─── Main entry: recompute a single trader's score ──────────────────

export async function recomputeTraderScore(
  db: SupabaseClient,
  userId: string,
): Promise<{ updated: boolean; reason?: string }> {
  const agg = await computeTraderAggregates(db, userId)
  if (!agg) return { updated: false, reason: 'No trades' }
  if (agg.totalTrades < 5) {
    return { updated: false, reason: `Need 5+ trades, has ${agg.totalTrades}` }
  }

  // Fetch verification tier
  const { data: verif } = await db
    .from('trader_verifications')
    .select('tier')
    .eq('user_id', userId)
    .maybeSingle()

  // Compute avg follower PnL from copy_trades
  const { data: copies } = await db
    .from('copy_trades')
    .select('follower_pnl')
    .eq('leader_id', userId)
    .eq('status', 'closed')
    .not('follower_pnl', 'is', null)
  const avgFollowerReturn = copies && copies.length > 0
    ? copies.reduce((s, c) => s + Number(c.follower_pnl ?? 0), 0)
        / copies.length / 10_000   // normalize against $10k
    : null

  const scores = calculateCompositeScore(agg, verif?.tier ?? 'none', avgFollowerReturn)
  const risk   = computeRiskScore({
    maxDdPct:     agg.maxDrawdownPct,
    winRate:      agg.winRate,
    totalTrades:  agg.totalTrades,
    sharpeRatio:  agg.sharpeRatio,
    profitFactor: agg.profitFactor,
  })

  // Get follower counts
  const [{ count: followers }, { count: copyFollowers }] = await Promise.all([
    db.from('trader_follows').select('*', { count: 'exact', head: true })
      .eq('leader_id', userId),
    db.from('strategy_subscriptions').select('*', { count: 'exact', head: true })
      .eq('copy_enabled', true)
      .eq('status', 'active')
      .in('strategy_id', (await db
        .from('published_strategies')
        .select('id')
        .eq('creator_id', userId)
      ).data?.map(s => s.id) ?? ['00000000-0000-0000-0000-000000000000']),
  ])

  const { error } = await db
    .from('trader_scores')
    .upsert({
      user_id:              userId,
      ...scores,
      win_rate:             Math.round(agg.winRate * 10_000) / 100,
      sharpe_ratio:         agg.sharpeRatio,
      sortino_ratio:        agg.sortinoRatio,
      max_drawdown_pct:     Math.round(agg.maxDrawdownPct * 10_000) / 100,
      profit_factor:        Math.round(agg.profitFactor * 100) / 100,
      total_trades:         agg.totalTrades,
      monthly_return_pct:   Math.round(agg.monthlyReturnPct * 100) / 100,
      all_time_return_pct:  Math.round(agg.allTimeReturnPct * 100) / 100,
      followers_count:      followers ?? 0,
      copy_followers_count: copyFollowers ?? 0,
      avg_follower_return:  avgFollowerReturn,
      risk_score:           risk.score,
      risk_label:           risk.label,
      risk_updated_at:      new Date().toISOString(),
      lookback_days:        90,
      computed_at:          new Date().toISOString(),
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    return { updated: false, reason: error.message }
  }
  return { updated: true }
}

// ─── Bulk recompute + rank assignment ─────────────────────────────────

export async function recomputeAllScores(
  db: SupabaseClient,
): Promise<{ processed: number; updated: number; errors: string[] }> {
  // Get all public profiles with at least 5 journal entries
  const { data: candidates } = await db
    .from('profiles')
    .select('id')
    .eq('public_profile', true)
    .not('public_handle', 'is', null)

  const result = { processed: 0, updated: 0, errors: [] as string[] }
  if (!candidates) return result

  for (const c of candidates) {
    result.processed += 1
    try {
      const r = await recomputeTraderScore(db, c.id)
      if (r.updated) result.updated += 1
    } catch (e) {
      result.errors.push(`${c.id}: ${String(e)}`)
    }
  }

  // Re-rank everyone by composite_score
  await assignRanks(db)
  return result
}

async function assignRanks(db: SupabaseClient): Promise<void> {
  const { data: ranked } = await db
    .from('trader_scores')
    .select('user_id, composite_rank')
    .order('composite_score', { ascending: false })

  if (!ranked) return

  // Update ranks in parallel batches
  await Promise.all(
    ranked.map((row, idx) => {
      const newRank = idx + 1
      const change  = row.composite_rank ? row.composite_rank - newRank : 0
      return db
        .from('trader_scores')
        .update({
          composite_rank:  newRank,
          rank_change_24h: change,
        })
        .eq('user_id', row.user_id)
    })
  )
}
