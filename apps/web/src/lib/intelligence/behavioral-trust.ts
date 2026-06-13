/**
 * Behavioral measurement-trust model (Phase / Step 2).
 *
 * Every behavioral metric is reported with TWO independent reliability axes:
 *
 *   confidence  — how much SAMPLE backs it (qualifying observations)
 *   assurance   — how TRUSTWORTHY the inputs are (objective broker/PnL data
 *                 vs self-reported journal fields)
 *
 * and a derived `trustLevel` the UI uses to communicate one honest signal:
 *
 *   "Score 82 · Trust: Medium — high sample, but relies on self-reported data."
 *
 * Two scores of equal value should NOT carry equal weight in a user's mind.
 * Pure, deterministic, no I/O.
 */

export type BehavioralConfidence = 'Insufficient' | 'Low' | 'Medium' | 'High'
export type Assurance            = 'Objective' | 'Mixed' | 'Self-Reported'
export type TrustLevel           = 'Insufficient' | 'Low' | 'Medium' | 'High'

/** Sample quality from qualifying observations. (Reuses the edge-analytics
 *  philosophy; thresholds tuned for behavioral opportunity counts.) */
export function behavioralConfidence(sample: number): BehavioralConfidence {
  if (!Number.isFinite(sample) || sample < 4) return 'Insufficient'
  if (sample < 10) return 'Low'
  if (sample < 25) return 'Medium'
  return 'High'
}

/**
 * Assurance per metric — does it rest on OBJECTIVE data (equity/PnL/risk/
 * timing/fills) or SELF-REPORTED journal fields (emotion_pre, mistakes,
 * rule_violation, notes, setup_tag), or a MIX?
 */
export const METRIC_ASSURANCE: Record<string, Assurance> = {
  resilience:        'Objective',     // equity curve only
  recovery:          'Objective',
  consistency:       'Objective',     // PnL distribution
  patience:          'Objective',     // inter-trade timing
  overtrade:         'Objective',     // daily trade counts
  weekend_gamble:    'Objective',     // timestamps
  recency_bias:      'Objective',     // pair/time/size
  revenge:           'Mixed',         // risk_pct + time (risk_pct may be self-entered)
  risk_inflation:    'Mixed',
  loss_chase:        'Mixed',
  confidence_drift:  'Mixed',         // lot_size/risk_pct
  tilt:              'Mixed',         // timing/risk objective + emotion self-reported
  self_control:      'Mixed',         // fomo/impulse self-reported + revenge/tilt mixed
  risk_discipline:   'Mixed',
  maturity:          'Mixed',         // composite of all
  rule_adherence:    'Self-Reported', // rule_violation flag
  discipline:        'Self-Reported',
  fomo:              'Self-Reported', // emotion/notes/tags
  impulse:           'Self-Reported', // setup_tag absence
  strategy_hopping:  'Self-Reported', // setup_tag
}

export function assuranceFor(metric: string): Assurance {
  return METRIC_ASSURANCE[metric] ?? 'Mixed'
}

/**
 * trustLevel = confidence × assurance. Self-reported evidence is capped at
 * Medium no matter how large the sample; objective + high sample is the only
 * path to High. Low/Insufficient sample dominates regardless of assurance.
 */
export function trustLevel(confidence: BehavioralConfidence, assurance: Assurance): TrustLevel {
  if (confidence === 'Insufficient') return 'Insufficient'
  if (confidence === 'Low') return 'Low'
  if (confidence === 'Medium') {
    return assurance === 'Self-Reported' ? 'Low' : 'Medium'
  }
  // High sample:
  if (assurance === 'Objective')     return 'High'
  if (assurance === 'Mixed')         return 'Medium'
  return 'Medium'                     // Self-Reported caps at Medium
}

export interface MetricTrust {
  metric:        string
  value:         number | null         // null = Insufficient Data
  confidence:    BehavioralConfidence
  assurance:     Assurance
  trust_level:   TrustLevel
  sample_size:   number                // qualifying observations
  evidence_count: number               // events actually detected
  verdict:       string                // one-line plain-English summary
}

export function buildMetricTrust(args: {
  metric: string
  value: number | null
  sample: number
  evidenceCount?: number
}): MetricTrust {
  const confidence = args.value == null ? 'Insufficient' : behavioralConfidence(args.sample)
  const assurance = assuranceFor(args.metric)
  const trust = trustLevel(confidence, assurance)
  return {
    metric:        args.metric,
    value:         args.value,
    confidence,
    assurance,
    trust_level:   trust,
    sample_size:   args.sample,
    evidence_count: args.evidenceCount ?? 0,
    verdict:       verdictFor(args.value, confidence, assurance, trust, args.sample),
  }
}

/**
 * Assemble the trust map for a whole behavioral report. Per-metric sample is
 * the QUALIFYING-OBSERVATION count (not total trades) so confidence is honest:
 * revenge/tilt/loss-chase are bounded by losses, risk-inflation by wins.
 * Takes the report structurally (type-only) so this stays node-testable.
 */
export function buildBehavioralTrust(r: {
  closed_trades: number; wins_count: number; losses_count: number
  consistency_score: number | null; resilience_score: number | null
  patience_score: number | null; self_control_score: number | null
  rule_adherence_score: number | null; risk_discipline_score: number | null
  tilt_score: number | null; tilt_events?: unknown[]
  revenge_risk: number | null; revenge_count: number
  risk_inflation_risk: number | null; risk_inflation_count: number
  loss_chase_risk: number | null; loss_chase_count: number
  fomo_risk: number | null; fomo_count: number
  impulse_risk: number | null; impulse_count: number
  overtrade_risk: number | null; overtrade_days: number
  trading_maturity_index: number | null
  rule_violations?: number
}): Record<string, MetricTrust> {
  const closed = r.closed_trades
  const wins = r.wins_count
  const losses = r.losses_count
  const m = (metric: string, value: number | null, sample: number, evidenceCount?: number) =>
    buildMetricTrust({ metric, value, sample, evidenceCount })
  return {
    // Window-sample metrics (scan all closed trades)
    resilience:      m('resilience',      r.resilience_score,      closed),
    consistency:     m('consistency',     r.consistency_score,     closed),
    patience:        m('patience',        r.patience_score,        closed),
    self_control:    m('self_control',    r.self_control_score,    closed),
    rule_adherence:  m('rule_adherence',  r.rule_adherence_score,  closed, r.rule_violations ?? 0),
    risk_discipline: m('risk_discipline', r.risk_discipline_score, closed),
    maturity:        m('maturity',        r.trading_maturity_index, closed),
    fomo:            m('fomo',            r.fomo_risk,             closed, r.fomo_count),
    impulse:         m('impulse',         r.impulse_risk,          closed, r.impulse_count),
    overtrade:       m('overtrade',       r.overtrade_risk,        closed, r.overtrade_days),
    // Opportunity-bounded metrics — sample is losses or wins, NOT total trades
    tilt:            m('tilt',            r.tilt_score,            losses, (r.tilt_events ?? []).length),
    revenge:         m('revenge',         r.revenge_risk,          losses, r.revenge_count),
    loss_chase:      m('loss_chase',      r.loss_chase_risk,       losses, r.loss_chase_count),
    risk_inflation:  m('risk_inflation',  r.risk_inflation_risk,   wins,   r.risk_inflation_count),
  }
}

function verdictFor(
  value: number | null, c: BehavioralConfidence, a: Assurance, t: TrustLevel, sample: number,
): string {
  if (value == null || c === 'Insufficient')
    return `Insufficient evidence — ${sample} qualifying observation${sample === 1 ? '' : 's'} (need 4+).`
  const why =
    t === 'High'   ? 'large sample, objective data'
  : t === 'Medium' && a === 'Self-Reported' ? 'large sample, but relies on self-reported data'
  : t === 'Medium' ? 'reasonable sample / data quality'
  : 'small sample — treat as directional'
  return `Trust: ${t} — ${why} (n=${sample}, ${a.toLowerCase()}).`
}
