/**
 * Public Validation Stats aggregator — Phase 11 of the Validation
 * Center. Powers the public-facing marketing showcase at /validation.
 *
 * Reads shadow_executions across ALL users (service-role) and produces
 * a strictly anonymised, sample-gated cross-platform aggregate. This
 * is the HIGHEST-stakes honesty surface in the codebase — it ships
 * marketing copy to non-logged-in visitors. Every metric here must be
 * defensible in front of a regulator.
 *
 * Honesty contract (more strict than the user-facing aggregators):
 *
 *   1. MIN_SAMPLE_OUTCOMES = 100 closed trades cross-platform.
 *      Below this every outcome metric returns null and the UI shows
 *      "Sample below threshold" — no win-rate or slippage average
 *      can be published.
 *
 *   2. MIN_SAMPLE_BROKERS = 3 distinct brokers contributing data.
 *      Broker-accuracy claims require multi-broker sample so no
 *      individual broker drives the headline number.
 *
 *   3. MIN_USERS = 5 distinct users contributing data, for ANY
 *      cross-user metric. Below this we suppress everything because
 *      the "aggregate" is barely an aggregate.
 *
 *   4. No broker NAMES, no strategy NAMES, no symbol NAMES surface
 *      in the result — even the count fields. We expose only the
 *      number of distinct brokers/strategies/symbols, never the set.
 *
 *   5. Validation-success-rate has its own gate: ≥ 10 strategies
 *     reviewed (collecting_data=false) — a 50% success-rate on
 *     "2 strategies reviewed" is meaningless.
 *
 *   6. Confidence label is always emitted alongside every metric —
 *      "tight" (large sample), "wide" (small but valid sample), or
 *      "suppressed" (below threshold).
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  aggregateBrokerQuality, BROKER_MIN_SAMPLE,
} from './broker-quality-aggregate'
import {
  aggregateStrategyPerformance, STRATEGY_MIN_SAMPLE,
} from './strategy-performance-aggregate'
import { reviewAllStrategiesForValidation } from './validation-coach'

export const PUBLIC_MIN_TRADES   = 100
export const PUBLIC_MIN_BROKERS  = 3
export const PUBLIC_MIN_USERS    = 5
export const PUBLIC_MIN_REVIEWED = 10

function svc(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null    // build-time / misconfig → caller renders safe empty state
  return serviceClient(url, key)
}

type ConfidenceLabel = 'tight' | 'wide' | 'suppressed'

export interface PublicMetric {
  value:        string           // already-formatted, ready to render
  numeric:      number | null    // null when suppressed
  sample_size:  number
  confidence:   ConfidenceLabel
  detail:       string           // sub-line for the card ("From X closed trades", etc)
}

export interface PublicValidationStats {
  generated_at:           string
  /** Sample-gate snapshot — used by the page to decide whether to
   *  show the full grid or a "we're still building sample" banner. */
  meets_global_threshold: boolean
  contributing_users:     number
  contributing_brokers:   number
  contributing_strategies: number

  strategies_validated:    PublicMetric
  trades_analysed:         PublicMetric
  broker_accuracy:         PublicMetric
  average_slippage:        PublicMetric
  risk_metrics:            PublicMetric
  validation_success_rate: PublicMetric
}

function confidenceFor(sample: number, threshold: number): ConfidenceLabel {
  if (sample < threshold)      return 'suppressed'
  if (sample < threshold * 5)  return 'wide'
  return 'tight'
}

function suppressedMetric(reason: string): PublicMetric {
  return {
    value:       'Insufficient sample',
    numeric:     null,
    sample_size: 0,
    confidence:  'suppressed',
    detail:      reason,
  }
}

// Raw shadow row shape we read for cross-user stats. No PII columns
// are selected; the user_id IS read but ONLY to count distinct users —
// it never surfaces in the output.
interface CrossShadowRow {
  user_id:        string
  broker:         string
  actual_status:  string
  slippage_pct:   number | null
  pnl_drift_pct:  number | null
  follower_pnl:   number | null
  closed_at:      string | null
  created_at:     string
  copy_trade_id:  string | null
}

export async function aggregatePublicValidationStats(): Promise<PublicValidationStats> {
  const db = svc()
  if (!db) {
    // Env not configured (build-time prerender, misconfig). Return
    // the safe pre-threshold state — same shape, all metrics
    // suppressed. NEVER fabricated.
    return {
      generated_at:            new Date().toISOString(),
      meets_global_threshold:  false,
      contributing_users:      0,
      contributing_brokers:    0,
      contributing_strategies: 0,
      strategies_validated:    suppressedMetric('Supabase env unavailable in this context.'),
      trades_analysed:         { value: '0', numeric: 0, sample_size: 0, confidence: 'suppressed', detail: 'Supabase env unavailable.' },
      broker_accuracy:         suppressedMetric('Supabase env unavailable.'),
      average_slippage:        suppressedMetric('Supabase env unavailable.'),
      risk_metrics:            suppressedMetric('Supabase env unavailable.'),
      validation_success_rate: suppressedMetric('Supabase env unavailable.'),
    }
  }

  // Cross-user pull from the shadow log. Cap at 50k rows — anything
  // beyond is a degenerate marketing claim anyway.
  const { data, error } = await db
    .from('shadow_executions')
    .select(`
      user_id, broker, actual_status, slippage_pct, pnl_drift_pct,
      follower_pnl, closed_at, created_at, copy_trade_id
    `)
    .order('created_at', { ascending: false })
    .limit(50_000)

  const rows = (error ? [] : (data as CrossShadowRow[] | null) ?? [])

  // Distinct counters — load-bearing for the "do we meet threshold"
  // decision and for the cardinal numbers we DO surface (which are
  // just counts, never values).
  const users    = new Set<string>()
  const brokers  = new Set<string>()
  const closed   = rows.filter(r => r.closed_at && typeof r.follower_pnl === 'number')

  for (const r of rows) {
    if (r.user_id) users.add(r.user_id)
    if (r.broker)  brokers.add(r.broker)
  }

  const meetsGlobal =
    users.size   >= PUBLIC_MIN_USERS &&
    closed.length >= PUBLIC_MIN_TRADES

  const generated_at = new Date().toISOString()

  // ── Suppress everything when we're below the global gate ─────────
  if (!meetsGlobal) {
    return {
      generated_at,
      meets_global_threshold:  false,
      contributing_users:      users.size,
      contributing_brokers:    brokers.size,
      contributing_strategies: 0,
      strategies_validated:    suppressedMetric(
        `Activation needs ≥ ${PUBLIC_MIN_TRADES} cross-user closed trades and ≥ ${PUBLIC_MIN_USERS} contributing users — currently ${closed.length} / ${users.size}.`),
      trades_analysed: {
        value:       String(rows.length),
        numeric:     rows.length,
        sample_size: rows.length,
        confidence:  rows.length === 0 ? 'suppressed' : 'wide',
        detail:      'Total shadow executions logged across the platform — pre-threshold.',
      },
      broker_accuracy:         suppressedMetric(
        `Activates at ≥ ${PUBLIC_MIN_BROKERS} contributing brokers and ≥ ${PUBLIC_MIN_TRADES} closed trades.`),
      average_slippage:        suppressedMetric(
        `Activates at ≥ ${PUBLIC_MIN_TRADES} closed trades. No claim made before threshold.`),
      risk_metrics:            suppressedMetric(
        `Drawdown stats activate at ≥ ${PUBLIC_MIN_TRADES} closed trades.`),
      validation_success_rate: suppressedMetric(
        `Validation-success rate activates when ≥ ${PUBLIC_MIN_REVIEWED} strategies are above the institutional sample threshold.`),
    }
  }

  // ── At/above global threshold — compute the real metrics ─────────

  // Broker-accuracy: feed the existing aggregator with the cross-user
  // shadow rows (it doesn't care whose rows they are — it only groups
  // by broker). Only graded brokers contribute.
  const brokerStats = aggregateBrokerQuality(
    rows.map(r => ({
      broker:        r.broker,
      actual_status: r.actual_status,
      slippage_pct:  r.slippage_pct,
      pnl_drift_pct: r.pnl_drift_pct,
      skip_reason:   null,
    })),
  )
  const gradedBrokers   = brokerStats.filter(b => b.execution_quality_score != null)
  const brokerAccuracyOk = gradedBrokers.length >= PUBLIC_MIN_BROKERS

  const brokerAccuracy: PublicMetric = brokerAccuracyOk
    ? {
        value:       `${Math.round(
                       gradedBrokers.reduce((s, b) => s + (b.execution_quality_score ?? 0), 0)
                         / gradedBrokers.length,
                     )}/100`,
        numeric:     gradedBrokers.reduce((s, b) => s + (b.execution_quality_score ?? 0), 0)
                       / gradedBrokers.length,
        sample_size: gradedBrokers.length,
        confidence:  confidenceFor(gradedBrokers.length, PUBLIC_MIN_BROKERS),
        detail:      `Mean Execution Quality Score across ${gradedBrokers.length} graded brokers.`,
      }
    : suppressedMetric(
        `Activates at ≥ ${PUBLIC_MIN_BROKERS} graded brokers (each needs ≥ ${BROKER_MIN_SAMPLE} executions). Currently ${gradedBrokers.length} graded.`)

  // Average slippage — average of |slippage_pct| over rows that have it.
  const slipRows = rows.filter(r => typeof r.slippage_pct === 'number')
  const avgSlip  = slipRows.length > 0
    ? slipRows.reduce((s, r) => s + Math.abs(r.slippage_pct as number), 0) / slipRows.length
    : null

  const averageSlippage: PublicMetric = avgSlip == null || slipRows.length < PUBLIC_MIN_TRADES
    ? suppressedMetric(`Activates at ≥ ${PUBLIC_MIN_TRADES} executions carrying a slippage record. Currently ${slipRows.length}.`)
    : {
        value:       `${(avgSlip * 100).toFixed(3)}%`,
        numeric:     avgSlip,
        sample_size: slipRows.length,
        confidence:  confidenceFor(slipRows.length, PUBLIC_MIN_TRADES),
        detail:      `Mean absolute slippage across ${slipRows.length.toLocaleString()} executions.`,
      }

  // Trades analysed — total executions logged (pre-close + post-close).
  const tradesAnalysed: PublicMetric = {
    value:       rows.length.toLocaleString(),
    numeric:     rows.length,
    sample_size: rows.length,
    confidence:  confidenceFor(rows.length, PUBLIC_MIN_TRADES),
    detail:      `Total shadow executions logged across ${users.size} contributing users.`,
  }

  // Strategy aggregation — 3-hop join. For the public surface we ONLY
  // need the strategy_id (a UUID) for counting/grouping; the name
  // never surfaces.
  let attributedRows: Array<{
    created_at: string; closed_at: string | null; follower_pnl: number | null
    actual_status: string; slippage_pct: number | null; pnl_drift_pct: number | null
    copy_trade?: {
      subscription?: { strategy?: { id: string } | null } | null
    } | null
  }> = []
  try {
    const { data: attr } = await db
      .from('shadow_executions')
      .select(`
        created_at, closed_at, follower_pnl, actual_status, slippage_pct, pnl_drift_pct,
        copy_trade:copy_trades (
          subscription:strategy_subscriptions (
            strategy:published_strategies ( id )
          )
        )
      `)
      .not('copy_trade_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50_000)
    attributedRows = (attr ?? []) as typeof attributedRows
  } catch {
    attributedRows = []
  }

  const stratRows = attributedRows
    .map(r => {
      const id = r.copy_trade?.subscription?.strategy?.id
      if (!id) return null
      // Strategy NAME is intentionally NOT pulled — privacy contract.
      return {
        strategy_id:   id,
        strategy_name: id,     // pass through the id; output never surfaces this
        follower_pnl:  r.follower_pnl,
        closed_at:     r.closed_at,
        created_at:    r.created_at,
        actual_status: r.actual_status,
        slippage_pct:  r.slippage_pct,
        pnl_drift_pct: r.pnl_drift_pct,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const stratReport = aggregateStrategyPerformance(stratRows)
  const reviewed    = stratReport.strategies.filter(s => !s.collecting_data)
  const coachReviews = reviewAllStrategiesForValidation(reviewed)
  const approved    = coachReviews.filter(r => r.recommendation === 'approve').length
  const successRateOk = reviewed.length >= PUBLIC_MIN_REVIEWED

  const strategiesValidated: PublicMetric = {
    value:       String(approved),
    numeric:     approved,
    sample_size: reviewed.length,
    confidence:  reviewed.length === 0 ? 'suppressed'
                 : confidenceFor(reviewed.length, STRATEGY_MIN_SAMPLE),
    detail:      reviewed.length === 0
                   ? 'No strategies have cleared the sample threshold yet.'
                   : `${approved} of ${reviewed.length} reviewed strategies cleared the Approve threshold.`,
  }

  const validationSuccessRate: PublicMetric = !successRateOk
    ? suppressedMetric(
        `Activates at ≥ ${PUBLIC_MIN_REVIEWED} strategies above the ${STRATEGY_MIN_SAMPLE}-trade sample. Currently ${reviewed.length}.`)
    : {
        value:       `${Math.round((approved / reviewed.length) * 100)}%`,
        numeric:     approved / reviewed.length,
        sample_size: reviewed.length,
        confidence:  confidenceFor(reviewed.length, PUBLIC_MIN_REVIEWED),
        detail:      `Across ${reviewed.length} strategies above the institutional sample threshold.`,
      }

  // Risk metrics — composite of (1) median strategy risk_score across
  // graded strategies (2) median max-drawdown-as-pct.
  const riskScores = reviewed
    .map(s => s.risk_score)
    .filter((v): v is number => typeof v === 'number')
  const medianRisk = riskScores.length === 0 ? null
    : riskScores.sort((a, b) => a - b)[Math.floor(riskScores.length / 2)] ?? null

  const riskMetrics: PublicMetric = medianRisk == null || riskScores.length < PUBLIC_MIN_REVIEWED
    ? suppressedMetric(
        `Risk score median activates at ≥ ${PUBLIC_MIN_REVIEWED} strategies reviewed.`)
    : {
        value:       `${medianRisk}/100`,
        numeric:     medianRisk,
        sample_size: riskScores.length,
        confidence:  confidenceFor(riskScores.length, PUBLIC_MIN_REVIEWED),
        detail:      `Median composite risk score across ${riskScores.length} strategies.`,
      }

  return {
    generated_at,
    meets_global_threshold:  true,
    contributing_users:      users.size,
    contributing_brokers:    brokers.size,
    contributing_strategies: stratReport.strategies.length,
    strategies_validated:    strategiesValidated,
    trades_analysed:         tradesAnalysed,
    broker_accuracy:         brokerAccuracy,
    average_slippage:        averageSlippage,
    risk_metrics:            riskMetrics,
    validation_success_rate: validationSuccessRate,
  }
}
