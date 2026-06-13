/**
 * Trust Engine (Phase 9).
 *
 * The mandatory chokepoint for EVERY user-visible intelligence score. A score
 * may not reach a surface except as a TrustResult — which, by construction,
 * always carries a confidence, a sample size, an evidence strength, a trust
 * level, and a plain-English explanation. There are no black boxes and no
 * un-gated numbers.
 *
 * Pure + runtime-self-contained (type-only imports) so it is node-testable.
 * The data-sufficiency floor is INJECTED (`min_sample`) rather than imported,
 * so the surface wires `data-sufficiency` → `trust-engine` explicitly and this
 * module has zero runtime coupling.
 *
 * Cardinal rule enforced here: value == null OR sample below floor → the
 * result is Insufficient / Very Low trust. Missing data can never become a
 * positive, high-trust score.
 */
import type { ExplanationInput } from './explainability'

export type TrustConfidence  = 'Insufficient' | 'Low' | 'Medium' | 'High'
export type EvidenceStrength  = 'None' | 'Weak' | 'Moderate' | 'Strong'
export type TrustLevel        = 'Very Low' | 'Low' | 'Medium' | 'High' | 'Verified'
export type Assurance         = 'Objective' | 'Mixed' | 'Self-Reported'

export interface TrustResult {
  metric_id:        string
  value:            number | null          // null = Insufficient Data
  confidence:       TrustConfidence
  sample_size:      number
  evidence_strength: EvidenceStrength
  trust_level:      TrustLevel
  explanation:      string                 // ALWAYS non-empty
  // Structured detail for ScoreExplainer (optional, never required to exist).
  formula?:         string
  inputs_used?:     ExplanationInput[]
  inputs_missing?:  string[]
  assurance?:       Assurance
}

export interface BuildTrustArgs {
  metric_id:       string
  value:           number | null
  sample_size:     number
  /** The sufficiency floor for this metric (from data-sufficiency.MIN_SAMPLE). */
  min_sample:      number
  /** Discrete events actually observed (e.g. flagged trades). Drives strength. */
  evidence_count?: number
  /** Optional confidence override for engines that gate on their OWN evidence
   *  signal (e.g. coach-eval's process-axis completeness) rather than sample
   *  size. When given, it replaces the sample-derived confidence — but a null
   *  value still forces 'Insufficient'. */
  confidence?:     TrustConfidence
  assurance?:      Assurance
  formula?:        string
  inputs_used?:    ExplanationInput[]
  inputs_missing?: string[]
  notes?:          string[]
}

function confidenceFor(value: number | null, sample: number, min: number): TrustConfidence {
  if (value == null || !Number.isFinite(sample) || sample < min) return 'Insufficient'
  if (sample < min * 2) return 'Low'
  if (sample < min * 5) return 'Medium'
  return 'High'
}

function evidenceFor(count: number): EvidenceStrength {
  if (count <= 0) return 'None'
  if (count < 3)  return 'Weak'
  if (count < 10) return 'Moderate'
  return 'Strong'
}

/**
 * trust_level = confidence × assurance, with a "Verified" ceiling reserved for
 * objective data backed by a strong sample. Self-reported evidence is capped
 * at Medium no matter the sample (you can always lie to your own journal).
 */
function trustLevelFor(
  confidence: TrustConfidence, assurance: Assurance, strength: EvidenceStrength,
): TrustLevel {
  if (confidence === 'Insufficient') return 'Very Low'
  if (confidence === 'Low')          return 'Low'
  if (confidence === 'Medium')       return assurance === 'Self-Reported' ? 'Low' : 'Medium'
  // High confidence:
  if (assurance === 'Self-Reported') return 'Medium'
  if (assurance === 'Mixed')         return 'Medium'
  // Objective + High sample + Strong evidence → the only path to Verified.
  return strength === 'Strong' ? 'Verified' : 'High'
}

/**
 * Wrap a computed value in the trust contract. ALWAYS returns a confidence and
 * a non-empty explanation — callers cannot bypass either.
 */
export function buildTrust(a: BuildTrustArgs): TrustResult {
  const assurance  = a.assurance ?? 'Mixed'
  const confidence = a.value == null ? 'Insufficient'
    : (a.confidence ?? confidenceFor(a.value, a.sample_size, a.min_sample))
  const strength   = evidenceFor(a.evidence_count ?? 0)
  const insufficient = confidence === 'Insufficient'
  const value      = insufficient ? null : a.value
  const trust      = trustLevelFor(confidence, assurance, strength)

  const why = insufficient
    ? `Insufficient Data — needs ${a.min_sample} observations, has ${Math.max(0, Math.floor(a.sample_size) || 0)}. Not scored.`
    : `${confidence} confidence (n=${a.sample_size}), ${assurance.toLowerCase()} evidence → Trust: ${trust}.`
  const explanation = [a.formula ? `Formula: ${a.formula}` : '', why, ...(a.notes ?? [])]
    .filter(Boolean).join(' ')

  return {
    metric_id:        a.metric_id,
    value,
    confidence,
    sample_size:      Math.max(0, Math.floor(a.sample_size) || 0),
    evidence_strength: strength,
    trust_level:      trust,
    explanation,
    formula:          a.formula,
    inputs_used:      a.inputs_used,
    inputs_missing:   a.inputs_missing,
    assurance,
  }
}

/** A surface may show a value as a positive judgement only when this is true. */
export function isTrustworthy(t: TrustResult): boolean {
  return t.value != null
    && t.confidence !== 'Insufficient'
    && t.trust_level !== 'Very Low'
}
