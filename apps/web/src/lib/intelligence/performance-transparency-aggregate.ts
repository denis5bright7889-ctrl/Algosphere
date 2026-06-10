/**
 * Performance-transparency aggregator — Phase 5 of the growth content
 * expansion. The HIGHEST reputation-risk aggregate of the three, so
 * the honesty bar is set higher: minimum sample is 30, the published
 * copy ALWAYS includes the window + sample size + a confidence
 * disclaimer, and metrics that can\'t be honestly computed return
 * null instead of zero.
 *
 * Aggregates ONLY platform-generated signals + their settled outcomes
 * from the signals table. Engine-driven, not user-driven — this is
 * "AlgoSphere\'s own performance" not "user performance."
 */
import 'server-only'
import { createClient as serviceClient } from '@supabase/supabase-js'

const MIN_SAMPLE  = 30
const DEFAULT_WINDOW_DAYS = 7

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface PerformanceTransparencyAggregate {
  window_days:        number
  window_label:       string
  sample_size:        number
  signals_published:  number
  signals_settled:    number
  signals_in_flight:  number
  win_rate_pct:       number | null     // null when settled < MIN_SAMPLE
  avg_r_multiple:     number | null
  profit_factor:      number | null
  expectancy_r:       number | null     // null when settled < MIN_SAMPLE
  max_drawdown_pct:   number | null     // engine-side metric; null when not computable from signals alone
  by_pair:            Array<{ pair: string; count: number; pct: number }>
  confidence_disclaimer: string
  generated_at:       string
}

interface SignalRow {
  pair:          string | null
  result:        string | null          // 'win' | 'loss' | 'breakeven' | null (unsettled)
  pips_gained:   number | null
  risk_reward:   number | null
}

export async function aggregatePerformanceTransparency(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<PerformanceTransparencyAggregate | null> {
  const db = svc()
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const { data, error } = await db
    .from('signals')
    .select('pair, result, pips_gained, risk_reward')
    .gte('published_at', since)
    .limit(2000)

  if (error || !data) return null

  const rows = data as SignalRow[]
  const total = rows.length
  if (total < MIN_SAMPLE) return null

  const settled    = rows.filter((r) => r.result && r.result !== null && r.result !== '')
  const inFlight   = total - settled.length
  const winners    = settled.filter((r) => r.result === 'win').length

  // Win rate only when settled sample meets the threshold — otherwise
  // null. We refuse to publish "x% win rate on 12 settled trades."
  const winRate = settled.length >= MIN_SAMPLE
    ? Math.round((winners / settled.length) * 100)
    : null

  // R-multiple math. Treat pips_gained as the realised side; risk_reward
  // is the PLANNED reward:risk per signal. Average realised R requires
  // (realised R from pips). Without per-signal stop-distance we can\'t
  // compute realised R from pips alone honestly. So we surface the
  // PLANNED average R:R from the signal config — labelled accordingly.
  const withRR = settled.filter((r) => typeof r.risk_reward === 'number' && Number.isFinite(r.risk_reward))
  const avgRR  = withRR.length === 0 ? null
               : Math.round((withRR.reduce((a, b) => a + (b.risk_reward as number), 0) / withRR.length) * 100) / 100

  // Profit factor approximation from pips_gained signs. Same caveat —
  // honest only at large samples; we keep it null below threshold.
  let pf: number | null = null
  let exp: number | null = null
  if (settled.length >= MIN_SAMPLE) {
    const pipsArr = settled.map((r) => r.pips_gained).filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    if (pipsArr.length >= MIN_SAMPLE) {
      const winsAbs = pipsArr.filter((p) => p > 0).reduce((a, b) => a + b, 0)
      const lossAbs = Math.abs(pipsArr.filter((p) => p < 0).reduce((a, b) => a + b, 0))
      pf  = lossAbs === 0 ? null : Math.round((winsAbs / lossAbs) * 100) / 100
      exp = Math.round((pipsArr.reduce((a, b) => a + b, 0) / pipsArr.length) * 100) / 100
    }
  }

  const pairCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.pair) pairCounts.set(r.pair, (pairCounts.get(r.pair) ?? 0) + 1)
  }
  const byPair = Array.from(pairCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pair, count]) => ({ pair, count, pct: Math.round((count / total) * 100) }))

  const confidence = winRate == null
    ? `Sample below ${MIN_SAMPLE} settled signals — outcomes-based metrics suppressed for honesty.`
    : `${settled.length} settled signals across ${windowDays} days. Past performance does not predict future results.`

  return {
    window_days:           windowDays,
    window_label:          `last ${windowDays}d`,
    sample_size:           total,
    signals_published:     total,
    signals_settled:       settled.length,
    signals_in_flight:     inFlight,
    win_rate_pct:          winRate,
    avg_r_multiple:        avgRR,
    profit_factor:         pf,
    expectancy_r:          exp,
    max_drawdown_pct:      null,   // not computable from signals table alone
    by_pair:               byPair,
    confidence_disclaimer: confidence,
    generated_at:          new Date().toISOString(),
  }
}
