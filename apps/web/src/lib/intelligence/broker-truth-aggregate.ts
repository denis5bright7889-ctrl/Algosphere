/**
 * Broker-truth aggregator — Phase 4 of the growth content expansion.
 *
 * Aggregates real broker-detected closed trades from journal_entries
 * (source IN auto_human/auto_engine/auto, exit_price NOT NULL) into
 * a public-shareable summary.
 *
 * Honesty contract:
 *   - Minimum sample: 20 closed trades in the window. Below that,
 *     returns null. No fabrication, no extrapolation.
 *   - All metrics are derived from real broker reality sync data
 *     (exit_price, pnl, commission, swap, closed_at all come from
 *     MT5\'s deal history).
 *   - Returns the window + sample size so the generator can stamp
 *     them on every published claim.
 */
import 'server-only'
import { createClient as serviceClient } from '@supabase/supabase-js'

const MIN_SAMPLE = 20
const DEFAULT_WINDOW_DAYS = 7

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface BrokerTruthAggregate {
  window_days:        number
  window_label:       string
  sample_size:        number
  win_rate_pct:       number
  avg_duration_hours: number | null
  avg_r_multiple:     number | null
  avg_pnl_usd:        number
  total_pnl_usd:      number
  most_traded:        Array<{ pair: string; count: number; pct: number }>
  most_active_session: { session: string; count: number; pct: number } | null
  brokers_represented: number
  generated_at:       string
}

interface JournalRow {
  pair:        string | null
  direction:   string | null
  pnl:         number | null
  duration_ms: number | null
  session:     string | null
  broker:      string | null
  // pips not used in the aggregate but loaded for completeness.
}

export async function aggregateBrokerTruth(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<BrokerTruthAggregate | null> {
  const db = svc()
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const { data, error } = await db
    .from('journal_entries')
    .select('pair, direction, pnl, duration_ms, session, broker')
    .in('source', ['auto', 'auto_human', 'auto_engine'])
    .not('exit_price', 'is', null)
    .gte('created_at', since)
    .limit(2000)

  if (error || !data) return null

  const rows = data as JournalRow[]
  if (rows.length < MIN_SAMPLE) return null

  // Win rate from PnL sign.
  const withPnl  = rows.filter((r) => typeof r.pnl === 'number' && Number.isFinite(r.pnl))
  const winners  = withPnl.filter((r) => (r.pnl as number) > 0).length
  const winRate  = withPnl.length === 0 ? 0 : Math.round((winners / withPnl.length) * 100)

  // Avg duration in hours.
  const durs    = rows.map((r) => r.duration_ms).filter((d): d is number => typeof d === 'number' && d > 0)
  const avgDurH = durs.length === 0 ? null
                : Math.round((durs.reduce((a, b) => a + b, 0) / durs.length) / 3_600_000 * 10) / 10

  // Avg + total PnL in account currency.
  const pnls    = withPnl.map((r) => r.pnl as number)
  const totPnl  = Math.round((pnls.reduce((a, b) => a + b, 0)) * 100) / 100
  const avgPnl  = pnls.length === 0 ? 0 : Math.round((totPnl / pnls.length) * 100) / 100

  // Avg R multiple — needs both pnl AND a risk reference. Without
  // risk_amount on broker-detected rows we can\'t honestly compute R,
  // so we leave it null rather than fabricate. (Engine-executed
  // trades will carry risk_amount; broker-detected typically don\'t.)
  const avgR    = null

  // Most-traded pairs (top 3).
  const pairCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.pair) pairCounts.set(r.pair, (pairCounts.get(r.pair) ?? 0) + 1)
  }
  const mostTraded = Array.from(pairCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pair, count]) => ({ pair, count, pct: Math.round((count / rows.length) * 100) }))

  // Most active session.
  const sessionCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.session) sessionCounts.set(r.session, (sessionCounts.get(r.session) ?? 0) + 1)
  }
  const sessionEntries = Array.from(sessionCounts.entries())
    .sort((a, b) => b[1] - a[1])
  const mostActive = sessionEntries[0]
    ? {
        session: sessionEntries[0][0],
        count:   sessionEntries[0][1],
        pct:     Math.round((sessionEntries[0][1] / rows.length) * 100),
      }
    : null

  const brokers = new Set<string>()
  for (const r of rows) {
    if (r.broker) brokers.add(r.broker)
  }

  return {
    window_days:         windowDays,
    window_label:        `last ${windowDays}d`,
    sample_size:         rows.length,
    win_rate_pct:        winRate,
    avg_duration_hours:  avgDurH,
    avg_r_multiple:      avgR,
    avg_pnl_usd:         avgPnl,
    total_pnl_usd:       totPnl,
    most_traded:         mostTraded,
    most_active_session: mostActive,
    brokers_represented: brokers.size,
    generated_at:        new Date().toISOString(),
  }
}
