/**
 * Decision Brain — learning math (GOVERNED, not auto-applied).
 *
 * Pure functions implementing the brief's weight-learning mechanism:
 * engine attribution from a closed outcome, the multiplicative update
 * rule, and normalisation. These are the building blocks of the closed
 * loop — but per docs/architecture/adaptive-intelligence.md the loop is
 * NOT run silently against the live vector. It requires:
 *   - accumulated, labelled decision volume (readiness gate below), and
 *   - explicit, audited activation (governance) before learned weights
 *     ever replace the W0 + regime-tilt baseline.
 *
 * Keeping the math here, pure and tested, means the moat (the system CAN
 * learn) exists without forfeiting control (humans gate every change).
 */
import { W0, normalizeWeights, type BriefEngine, type WeightVector } from './weights'

/** Minimum labelled samples before any learned weight is authoritative. */
export const MIN_SAMPLES_TO_LEARN = 30

export type Outcome = 'WIN' | 'LOSS' | 'FLAT'

/**
 * One labelled training record: the engine scores that produced a
 * decision, plus the realised outcome. `engineScores` are the [0,1]
 * scores at decision time; `decisionLean` is the net directional lean the
 * brain committed to (-1..+1).
 */
export interface TrainingRecord {
  engineScores:  Partial<Record<BriefEngine, number>>
  decisionLean:  number          // -1..+1 the brain leaned
  outcome:       Outcome
  pnl:           number          // signed realised return (or proxy)
}

/**
 * Per-engine attribution for one outcome. An engine that leaned the same
 * way as the realised move (score > 0.5 on a win, < 0.5 on a loss) earns
 * a positive contribution; one that leaned against it earns negative.
 * Returns contribution in [-1, 1] per engine present in the record.
 */
export function attributeEngines(rec: TrainingRecord): Partial<Record<BriefEngine, number>> {
  if (rec.outcome === 'FLAT') return {}      // no signal to attribute
  const winSign = rec.outcome === 'WIN' ? 1 : -1
  // The realised direction = the lean direction on a win, opposite on a loss.
  const realisedUp = (rec.decisionLean >= 0) === (winSign === 1)
  const out: Partial<Record<BriefEngine, number>> = {}
  for (const k of Object.keys(rec.engineScores) as BriefEngine[]) {
    const score = rec.engineScores[k]
    if (typeof score !== 'number') continue
    const engineLeanUp = score >= 0.5
    const aligned = engineLeanUp === realisedUp
    const magnitude = Math.abs(score - 0.5) * 2   // 0..1 conviction of this engine
    out[k] = (aligned ? 1 : -1) * magnitude
  }
  return out
}

/**
 * Multiplicative weight update (brief rule):
 *   weight_new = weight_old × (1 + alpha × performance_delta)
 * performance_delta is the engine's mean attribution across the batch.
 * Result is renormalised to sum to 1. alpha clamped to [0.01, 0.05].
 */
export function updateWeights(
  current: WeightVector,
  attributionBatch: Array<Partial<Record<BriefEngine, number>>>,
  alpha = 0.03,
): WeightVector {
  const a = Math.max(0.01, Math.min(0.05, alpha))
  const sums = {} as Record<BriefEngine, number>
  const counts = {} as Record<BriefEngine, number>
  for (const attr of attributionBatch) {
    for (const k of Object.keys(attr) as BriefEngine[]) {
      sums[k] = (sums[k] ?? 0) + (attr[k] ?? 0)
      counts[k] = (counts[k] ?? 0) + 1
    }
  }
  const next = {} as WeightVector
  for (const k of Object.keys(current) as BriefEngine[]) {
    const delta = counts[k] ? sums[k] / counts[k] : 0   // mean attribution, -1..1
    next[k] = current[k] * (1 + a * delta)
  }
  return normalizeWeights(next)
}

export interface ReadinessReport {
  decisions_logged:   number
  outcomes_labelled:  number
  min_required:       number
  learning_active:    boolean
  reason:             string
}

/**
 * Honest readiness gate. Until enough labelled outcomes exist, learning
 * stays inactive and the brain runs on W0 + regime tilt. Never claims to
 * have "learned" from noise.
 */
export function summarizeReadiness(decisionsLogged: number, outcomesLabelled: number): ReadinessReport {
  const ready = outcomesLabelled >= MIN_SAMPLES_TO_LEARN
  return {
    decisions_logged:  decisionsLogged,
    outcomes_labelled: outcomesLabelled,
    min_required:      MIN_SAMPLES_TO_LEARN,
    learning_active:   false, // governed: never auto-applied in this build
    reason: ready
      ? `Sufficient labelled outcomes (${outcomesLabelled}) — learned weights can be PROPOSED for governed activation; live vector remains W0 + regime tilt until approved.`
      : `Only ${outcomesLabelled}/${MIN_SAMPLES_TO_LEARN} labelled outcomes — learning bootstrapped at W0 + regime tilt to avoid learning from noise.`,
  }
}

/** The baseline the live brain uses; re-exported for the admin report. */
export { W0 }
