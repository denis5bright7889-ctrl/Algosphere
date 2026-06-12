/**
 * Explainability Layer (Phase 8) — every score must be able to say exactly
 * why it exists: which inputs it used, which were missing, the sample size,
 * the confidence, and the formula. No black boxes.
 *
 * Pure functions that turn a score + its source data into a ScoreExplanation
 * the UI can render in a "why is this 72?" popover. Re-uses the confidence
 * vocabulary from coach-eval (v3) and edge-confidence (Phase 6).
 */
import type { EvaluatorInput, CoachEvaluation, Confidence } from './coach-eval'
import type { EdgeConfidence } from './edge-confidence'

export interface ExplanationInput {
  name:    string
  value:   string | number | boolean | null
  present: boolean
}

export interface ScoreExplanation {
  label:          string                       // "Risk Score"
  value:          number | null                // 72 | null (Insufficient Data)
  unit?:          string                        // "/100"
  confidence:     Confidence | EdgeConfidence
  formula:        string                        // plain-English formula
  inputs_used:    ExplanationInput[]
  inputs_missing: string[]
  sample_size?:   number                        // n trades behind the score
  notes?:         string[]
}

const fmt = (v: unknown): string | number | boolean | null =>
  v == null || v === '' ? null : (v as string | number | boolean)

function field(name: string, value: unknown): ExplanationInput {
  const v = fmt(value)
  return { name, value: v, present: v != null }
}

/** Split a field list into used (present) vs missing names. */
function partition(fields: ExplanationInput[]): { used: ExplanationInput[]; missing: string[] } {
  return {
    used: fields.filter((f) => f.present),
    missing: fields.filter((f) => !f.present).map((f) => f.name),
  }
}

// ─── Coach evaluation → explanations (overall + 5 axes) ─────────────

const AXIS_SPEC: Record<string, { label: string; fields: (keyof EvaluatorInput)[]; formula: string }> = {
  execution:  { label: 'Execution', fields: ['entry_quality', 'exit_quality', 'management_quality'],
                formula: 'Weighted average of the rated components (entry 35% · management 35% · exit 30%), renormalised over what was logged. No imputation.' },
  psychology: { label: 'Psychology', fields: ['emotion_pre', 'reason_for_entry', 'revenge_trade', 'confidence_level'],
                formula: 'Neutral 60 anchor adjusted by pre-trade emotion, entry reason, revenge flag, and confidence-vs-setup alignment. Requires ≥1 logged signal.' },
  risk:       { label: 'Risk', fields: ['risk_pct', 'setup_validity'],
                formula: 'Banded on risk %: 0.4–1.5% rewarded, >2% / >5% penalised, oversize on an invalid setup penalised. Requires logged risk %.' },
  discipline: { label: 'Discipline', fields: ['rule_compliance', 'rule_violation', 'mistakes', 'reflection'],
                formula: 'Base 65 ± rule compliance, revenge flag, logged mistakes, and self-reflection. Requires a logged compliance/violation/mistake/reflection.' },
  timing:     { label: 'Timing', fields: ['setup_validity', 'strategy_used', 'market_regime', 'session'],
                formula: 'Setup validity + strategy×regime fit (prior, low confidence) + session liquidity. Requires setup validity, a strategy×regime pair, or a session.' },
}

/** The subset of a coach evaluation the explainer needs — so both the full
 *  CoachEvaluation and the client-side CoachEvalSummary can be passed. */
export type CoachEvalLike =
  Pick<CoachEvaluation, 'quality_score' | 'execution_grade' | 'psychology_grade'
    | 'risk_grade' | 'discipline_grade' | 'timing_grade'>
  & { confidence: Confidence; data_completeness: number }

export function explainCoachEvaluation(
  input: EvaluatorInput, ev: CoachEvalLike,
): { overall: ScoreExplanation; axes: ScoreExplanation[] } {
  const axisScore: Record<string, number | null> = {
    execution: ev.execution_grade, psychology: ev.psychology_grade,
    risk: ev.risk_grade, discipline: ev.discipline_grade, timing: ev.timing_grade,
  }

  const axes: ScoreExplanation[] = Object.entries(AXIS_SPEC).map(([key, spec]) => {
    const fields = spec.fields.map((f) => field(String(f), input[f]))
    const { used, missing } = partition(fields)
    const value = axisScore[key] ?? null
    return {
      label: spec.label,
      value,
      unit: '/100',
      confidence: value == null ? 'insufficient' : (used.length >= 2 ? 'high' : 'low') as Confidence,
      formula: spec.formula,
      inputs_used: used,
      inputs_missing: missing,
      notes: value == null ? ['No evidence logged for this axis — shown as Insufficient Data, not scored.'] : undefined,
    }
  })

  const evidencedAxes = axes.filter((a) => a.value != null).map((a) => a.label)
  const overall: ScoreExplanation = {
    label: 'AI Trader Score (this trade)',
    value: ev.quality_score,
    unit: '/100',
    confidence: ev.confidence,
    formula: 'Mean of the EVIDENCED process axes only (Execution, Psychology, Risk, Discipline, Timing). PnL never enters the score — a losing trade can grade A on process. Zero evidence → Insufficient Data.',
    inputs_used: evidencedAxes.map((label) => ({ name: label, value: axes.find((a) => a.label === label)!.value, present: true })),
    inputs_missing: axes.filter((a) => a.value == null).map((a) => a.label),
    sample_size: 1,
    notes: [
      `Data completeness: ${Math.round(ev.data_completeness * 5)}/5 process areas logged → confidence "${ev.confidence}".`,
      ev.quality_score == null ? 'Not enough logged to grade this trade.' : 'Grade is process-based, not outcome-based.',
    ],
  }
  return { overall, axes }
}

// ─── Edge cohort → explanation ──────────────────────────────────────

export function explainEdge(args: {
  label: string; trades: number; wins: number; win_rate: number; expectancy: number
  confidence: EdgeConfidence; verdict: string; win_rate_ci?: { low: number; high: number }
}): ScoreExplanation {
  return {
    label: args.label,
    value: Math.round(args.win_rate * 100),
    unit: '% win rate',
    confidence: args.confidence,
    formula: 'Win rate = wins / closed trades. Verdict from expectancy (avg PnL per trade), gated by sample size: no profitable/unprofitable label below 10 closed trades.',
    inputs_used: [
      { name: 'closed trades', value: args.trades, present: true },
      { name: 'wins', value: args.wins, present: true },
      { name: 'expectancy ($/trade)', value: Math.round(args.expectancy * 100) / 100, present: true },
    ],
    inputs_missing: [],
    sample_size: args.trades,
    notes: [
      `Verdict: ${args.verdict}.`,
      args.win_rate_ci ? `95% CI for win rate: ${Math.round(args.win_rate_ci.low * 100)}–${Math.round(args.win_rate_ci.high * 100)}% (Wilson).` : '',
      args.confidence === 'insufficient' ? `Below the 10-trade evidence floor — not a statistically defensible edge yet.` : `Confidence: ${args.confidence}.`,
    ].filter(Boolean),
  }
}

// ─── Drawdown → explanation ─────────────────────────────────────────

export function explainDrawdown(args: {
  maxDrawdownPct: number; maxDrawdownUsd: number; startingBalance: number; trades: number
}): ScoreExplanation {
  const known = args.startingBalance > 0
  return {
    label: 'Max Drawdown',
    value: Math.round(args.maxDrawdownPct * 100) / 100,
    unit: '%',
    confidence: !args.trades ? 'insufficient' : known ? 'high' : 'low',
    formula: 'Peak-to-trough decline of the equity curve: (peak_equity − trough_equity) / peak_equity, peak seeded at the starting balance, clamped to 0–100%.',
    inputs_used: [
      { name: 'starting balance', value: known ? args.startingBalance : 'unknown (PnL-relative)', present: known },
      { name: 'closed trades', value: args.trades, present: args.trades > 0 },
      { name: 'max drawdown ($)', value: args.maxDrawdownUsd, present: true },
    ],
    inputs_missing: known ? [] : ['starting balance'],
    sample_size: args.trades,
    notes: known ? undefined
      : ['Starting balance unknown — drawdown is relative to the PnL high-water mark; provide an account balance for an exact equity-based %.'],
  }
}
