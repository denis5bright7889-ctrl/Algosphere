/**
 * Broker Quality aggregator — Phase 3 of the Validation Center.
 *
 * Reads the user's shadow_executions rows, groups by broker, and
 * computes the broker-grade card the spec calls for:
 *
 *   • Execution Quality Score (0–100 composite)
 *   • Average Slippage
 *   • Fill Reliability
 *   • Requote Frequency
 *   • Spread Efficiency  (placeholder — not in shadow_executions
 *                          schema yet; null until the bridge logs it)
 *   • Execution Latency  (same — null until logged)
 *   • Grade (A+ / A / B+ / B / C / D)
 *   • Percentile vs the user's OTHER brokers (only meaningful with ≥2)
 *
 * Honesty contract:
 *   - Minimum sample per broker: 10 shadow executions. Below that
 *     the broker shows up in a "Collecting Data" state with the score
 *     suppressed (`null`), not zero.
 *   - Metrics that have no source column yet (latency, spread
 *     efficiency, requote count) return null — UI renders "—".
 *   - Percentile rank is null unless the user has ≥2 brokers with
 *     sample ≥ MIN_SAMPLE — one-broker comparisons are meaningless.
 *
 * Pure: same input rows → same output. No randomness, no LLM.
 */

export const BROKER_MIN_SAMPLE = 10

export type BrokerGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D'

export interface ShadowExecutionRow {
  broker:         string
  actual_status:  string
  slippage_pct:   number | null
  pnl_drift_pct:  number | null
  skip_reason:    string | null
}

export interface BrokerQuality {
  broker:                   string
  sample_size:              number
  fill_rate_pct:            number
  avg_slippage_pct:         number | null
  avg_drift_pct:            number | null
  mirrored_count:           number
  failed_count:             number
  skipped_count:            number
  requote_count:            number | null         // null = no source column yet
  spread_efficiency_pct:    number | null
  execution_latency_ms:     number | null
  execution_quality_score:  number | null         // 0–100, null below threshold
  grade:                    BrokerGrade | null
  percentile_rank:          number | null         // 0–99 among observed brokers
  better_than_pct:          number | null         // 100 - percentile_rank
}

function gradeFor(score: number): BrokerGrade {
  if (score >= 95) return 'A+'
  if (score >= 90) return 'A'
  if (score >= 85) return 'B+'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  return 'D'
}

/**
 * Composite Execution Quality Score on a 0-100 scale.
 *   • fill_rate         (40% weight) — most important: did the order land
 *   • slippage          (35% weight) — how close to intended price
 *   • drift             (25% weight) — leader/follower PnL alignment
 *
 * Each component normalises to [0, 1] against a "good enough" anchor:
 *   • fill_rate 100% → 1.0, 90% → ~0.8, 80% → ~0.6 (linear above 70)
 *   • slippage 0% → 1.0, 0.1% → 0.5, 0.2% → 0.0 (linear)
 *   • drift 0% → 1.0, 2% → 0.5, 5%+ → 0.0
 */
function compositeScore(
  fillRatePct: number,
  avgSlippagePct: number | null,
  avgDriftPct: number | null,
): number | null {
  // Fill rate always present (any row counts toward it).
  const fill = Math.max(0, Math.min(1, (fillRatePct - 70) / 30))

  // Slippage + drift use closed trades only — if those are missing,
  // we still produce a score but weighted toward fill rate.
  const slip = avgSlippagePct == null ? null
             : Math.max(0, Math.min(1, 1 - (avgSlippagePct / 0.002)))   // 0.2% = bad
  const drift = avgDriftPct == null ? null
              : Math.max(0, Math.min(1, 1 - (avgDriftPct / 5)))         // 5% = bad

  if (slip == null && drift == null) {
    // Only the fill component is observable; report it on its own scale.
    return Math.round(fill * 100)
  }
  if (slip == null) {
    return Math.round((fill * 0.6 + (drift as number) * 0.4) * 100)
  }
  if (drift == null) {
    return Math.round((fill * 0.55 + slip * 0.45) * 100)
  }
  return Math.round((fill * 0.40 + slip * 0.35 + drift * 0.25) * 100)
}

export function aggregateBrokerQuality(rows: ShadowExecutionRow[]): BrokerQuality[] {
  // Group by broker.
  const byBroker = new Map<string, ShadowExecutionRow[]>()
  for (const r of rows) {
    if (!r.broker) continue
    const list = byBroker.get(r.broker) ?? []
    list.push(r)
    byBroker.set(r.broker, list)
  }

  const out: BrokerQuality[] = []
  for (const [broker, list] of byBroker) {
    const sample = list.length
    const mirrored = list.filter(r =>
      r.actual_status === 'mirrored' || r.actual_status === 'testnet'
    ).length
    const failed  = list.filter(r => r.actual_status === 'failed').length
    const skipped = list.filter(r => r.actual_status === 'skipped' || r.actual_status === 'shadow_only').length

    const fillRate = sample > 0 ? Math.round((mirrored / sample) * 100) : 0

    const slipRows = list.filter(r => typeof r.slippage_pct === 'number')
    const avgSlip = slipRows.length > 0
      ? slipRows.reduce((s, r) => s + Math.abs(r.slippage_pct as number), 0) / slipRows.length
      : null

    const driftRows = list.filter(r => typeof r.pnl_drift_pct === 'number')
    const avgDrift = driftRows.length > 0
      ? driftRows.reduce((s, r) => s + Math.abs(r.pnl_drift_pct as number), 0) / driftRows.length
      : null

    // Below-threshold brokers go in the result but with score/grade null
    // — the UI surfaces them with a "Collecting Data" pill so the user
    // can see them but doesn't read fabricated grades.
    let score: number | null = null
    let grade: BrokerGrade | null = null
    if (sample >= BROKER_MIN_SAMPLE) {
      score = compositeScore(fillRate, avgSlip, avgDrift)
      grade = score != null ? gradeFor(score) : null
    }

    out.push({
      broker,
      sample_size:             sample,
      fill_rate_pct:           fillRate,
      avg_slippage_pct:        avgSlip == null ? null : Math.round(avgSlip * 1_000_000) / 1_000_000,
      avg_drift_pct:           avgDrift == null ? null : Math.round(avgDrift * 100) / 100,
      mirrored_count:          mirrored,
      failed_count:            failed,
      skipped_count:           skipped,
      requote_count:           null,
      spread_efficiency_pct:   null,
      execution_latency_ms:    null,
      execution_quality_score: score,
      grade,
      percentile_rank:         null,
      better_than_pct:         null,
    })
  }

  // Percentile rank — only meaningful with ≥2 graded brokers in the
  // same user's set. Without that, we leave it null.
  const graded = out.filter(b => b.execution_quality_score != null)
  if (graded.length >= 2) {
    // Sort ascending by score so rank 0 = worst.
    const sorted = [...graded].sort((a, b) =>
      (a.execution_quality_score as number) - (b.execution_quality_score as number)
    )
    for (let i = 0; i < sorted.length; i++) {
      const rank = Math.round((i / (sorted.length - 1)) * 100)
      const broker = sorted[i]!.broker
      const target = out.find(b => b.broker === broker)!
      target.percentile_rank = rank
      target.better_than_pct = rank
    }
  }

  // Best-first ordering by score (graded brokers above ungraded).
  out.sort((a, b) => {
    const sa = a.execution_quality_score ?? -1
    const sb = b.execution_quality_score ?? -1
    if (sa !== sb) return sb - sa
    return b.sample_size - a.sample_size
  })

  return out
}
