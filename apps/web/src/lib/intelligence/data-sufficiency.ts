/**
 * Data Sufficiency Registry (Phase 9).
 *
 * The SINGLE source of truth for "how much evidence does each metric need
 * before it may be scored at all?". Below the minimum, a metric is NOT
 * estimated, NOT defaulted, NOT given a baseline — it is `Insufficient Data`.
 *
 * Pure + self-contained (no imports) so it is node-testable and can be the
 * dependency every surface injects into the trust-engine.
 */

export type SufficiencyStatus = 'ok' | 'insufficient'

/** Minimum qualifying observations per metric family. Tunable in ONE place. */
export const MIN_SAMPLE = {
  win_rate:            20,   // WIN_RATE_MIN_TRADES
  edge:                10,   // EDGE_MIN_TRADES (pair/strategy edge)
  setup:               10,   // SETUP_MIN_OCCURRENCES
  session:             10,
  psychology:          20,   // PSYCHOLOGY_MIN_JOURNALS
  timing:              10,   // TIMING_MIN_SIGNALS
  // Behavioral sub-metrics use qualifying-opportunity counts.
  behavioral_axis:      8,
  behavioral_opportunity: 4,
  drawdown:             5,
  strategy_grade:      30,
} as const

export type MetricFamily = keyof typeof MIN_SAMPLE

export interface SufficiencyResult {
  status:  SufficiencyStatus
  family:  MetricFamily
  min:     number
  have:    number
  /** How far past the floor, 0..1+ (1 = exactly at floor). For confidence. */
  ratio:   number
  reason?: string
}

/**
 * Assess whether `have` qualifying observations clears the floor for a metric
 * family. Returns `insufficient` (never a number) when below — callers MUST
 * surface "Insufficient Data", not a fabricated score.
 */
export function assessSufficiency(family: MetricFamily, have: number): SufficiencyResult {
  const min = MIN_SAMPLE[family]
  const n = Number.isFinite(have) && have > 0 ? Math.floor(have) : 0
  if (n < min) {
    return {
      status: 'insufficient', family, min, have: n, ratio: n / min,
      reason: `Need ${min} ${family.replace(/_/g, ' ')} observations to score — have ${n}.`,
    }
  }
  return { status: 'ok', family, min, have: n, ratio: n / min }
}

/** Convenience guard: true when there is enough evidence to score. */
export function hasSufficientData(family: MetricFamily, have: number): boolean {
  return assessSufficiency(family, have).status === 'ok'
}
