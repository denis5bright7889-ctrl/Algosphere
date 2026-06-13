/**
 * Contradiction Engine (Phase 9).
 *
 * Encodes the rules that should make a displayed output IMPOSSIBLE because it
 * contradicts the underlying reality. Runs over a snapshot of a user's
 * platform-facing facts and returns every violation with a severity. Used both
 * at render time (to suppress/annotate) and as a CI gate (build fails if the
 * contradiction count rises).
 *
 * Pure + self-contained (no imports) → node-testable.
 */

export type ContradictionSeverity = 'critical' | 'high' | 'medium'

export interface PlatformFacts {
  profit_factor?:       number | null   // gross win / gross loss
  overall_score?:       number | null   // 0..100 composite
  rating?:              string | null   // 'Strong' | 'Steady' | ...
  verified_edge?:       boolean         // any cohort cleared the edge floor
  setup_coverage?:      number | null   // 0..1 fraction of trades with setup_tag
  discipline?:          number | null   // 0..100 (higher = better)
  net_pnl?:             number | null
  coaching_confidence?: string | null   // 'high' | 'medium' | 'low' | 'insufficient'
  impulse_risk?:        number | null   // 0..100 (higher = worse)
}

export interface Contradiction {
  code:     string
  severity: ContradictionSeverity
  message:  string
  fields:   string[]
}

const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Detect every contradiction present in a facts snapshot. */
export function detectContradictions(f: PlatformFacts): Contradiction[] {
  const out: Contradiction[] = []

  // R1 — a losing edge cannot produce a strong overall score.
  if (has(f.profit_factor) && has(f.overall_score) && f.profit_factor < 0.5 && f.overall_score > 70) {
    out.push({
      code: 'PF_LOW_SCORE_HIGH', severity: 'critical',
      message: `Profit factor ${f.profit_factor.toFixed(2)} (<0.5) but overall score ${f.overall_score} (>70).`,
      fields: ['profit_factor', 'overall_score'],
    })
  }

  // R2 — no verified edge cannot be rated "Strong".
  if (f.verified_edge === false && (f.rating ?? '').toLowerCase() === 'strong') {
    out.push({
      code: 'NO_EDGE_RATED_STRONG', severity: 'critical',
      message: `Rated "Strong" with no statistically verified edge.`,
      fields: ['verified_edge', 'rating'],
    })
  }

  // R3 — almost no setup attribution cannot be high discipline.
  if (has(f.setup_coverage) && has(f.discipline) && f.setup_coverage < 0.20 && f.discipline > 80) {
    out.push({
      code: 'LOW_SETUP_HIGH_DISCIPLINE', severity: 'high',
      message: `Setup coverage ${Math.round(f.setup_coverage * 100)}% (<20%) but discipline ${f.discipline} (>80).`,
      fields: ['setup_coverage', 'discipline'],
    })
  }

  // R4 — a net loss cannot yield high-confidence coaching praise.
  if (has(f.net_pnl) && f.net_pnl < 0 && (f.coaching_confidence ?? '').toLowerCase() === 'high') {
    out.push({
      code: 'NET_LOSS_HIGH_COACH_CONF', severity: 'high',
      message: `Net P&L ${f.net_pnl.toFixed(2)} (loss) but coaching confidence is "high".`,
      fields: ['net_pnl', 'coaching_confidence'],
    })
  }

  // R5 — heavy impulse trading cannot coexist with high discipline.
  if (has(f.impulse_risk) && has(f.discipline) && f.impulse_risk > 80 && f.discipline > 80) {
    out.push({
      code: 'IMPULSE_HIGH_DISCIPLINE_HIGH', severity: 'critical',
      message: `Impulse risk ${f.impulse_risk} (>80) but discipline ${f.discipline} (>80).`,
      fields: ['impulse_risk', 'discipline'],
    })
  }

  return out
}

/** Worst severity present, or null when clean. */
export function worstSeverity(cs: Contradiction[]): ContradictionSeverity | null {
  if (cs.some((c) => c.severity === 'critical')) return 'critical'
  if (cs.some((c) => c.severity === 'high'))     return 'high'
  if (cs.some((c) => c.severity === 'medium'))   return 'medium'
  return null
}
