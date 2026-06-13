/**
 * Deterministic per-trade coach evaluator (Journal V3 → trust-hardened V3.1).
 *
 * Pure-function, never fails. Reads the structured behavioral record the V3
 * form captures (Strategy + Psychology + Execution + Outcome) and emits five
 * PROCESS grades + an overall + insights.
 *
 * TRUST AUDIT (v3, EVALUATOR_VERSION 3) — cardinal rule: missing data is never
 * scored as positive behavior.
 *   • Each axis returns a score ONLY when it has evidence; otherwise `null`
 *     ("Insufficient Data"). The old baselines (55–65) that made an EMPTY
 *     trade score ~56/"C" are gone.
 *   • Overall = mean of EVIDENCED axes only (no imputation). Zero evidence →
 *     quality_score = null, grade = null, confidence = 'insufficient'.
 *   • Every evaluation carries `confidence` + `data_completeness` so the UI
 *     can show how much the score can be trusted.
 *   • ONE grade scale (gradeForScore) — no more dual A+/A-F bands.
 *
 * PnL never enters a process grade (a losing trade can be A-grade process).
 *
 * Phase 10 (TrustResult migration): every evaluation now also carries a
 * `trust` TrustResult — the platform-wide contract {value, confidence,
 * sample_size, evidence_strength, trust_level, explanation}. Coach data is
 * SELF-REPORTED, so trust is capped at Medium regardless of completeness.
 */
import { buildTrust, type TrustResult, type TrustConfidence } from './trust-engine'

export interface EvaluatorInput {
  // ─── Core ──
  pair?:           string | null
  direction?:      string | null
  pnl?:            number | null
  pips?:           number | null

  // ─── Strategy context (V3) ──
  strategy_used?:  string | null
  setup_validity?: string | null
  market_regime?:  string | null
  market_context?: string | null   // legacy alias
  session?:        string | null
  setup_tag?:      string | null

  // ─── Psychology context (V3) ──
  emotion_pre?:       string | null
  emotion_post?:      string | null
  reason_for_entry?:  string | null
  revenge_trade?:     boolean | null
  rule_compliance?:   string | null
  confidence_level?:  number | null

  // ─── Execution quality (V3) ──
  entry_quality?:      string | null
  exit_quality?:       string | null
  management_quality?: string | null

  // ─── Thesis + reflection (V3) ──
  thesis?:             string | null
  entry_confirmation?: string | null
  invalidations?:      string | null
  reflection?:         string | null

  // ─── Legacy / shared fields ──
  risk_pct?:           number | null
  risk_amount?:        number | null
  rule_violation?:     boolean | null
  mistakes?:           string[] | null
  what_went_well?:     string | null
  improvements?:       string | null
  notes?:              string | null
  regime_at_entry?:    string | null
}


export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type Confidence  = 'high' | 'medium' | 'low' | 'insufficient'

/**
 * THE single canonical grade scale (trust audit — was previously two
 * inconsistent scales in this file). 0-100 → letter, null-safe.
 *    ≥85 A · ≥70 B · ≥55 C · ≥40 D · <40 F · null → null (Insufficient Data)
 */
export function gradeForScore(score: number | null | undefined): LetterGrade | null {
  if (score == null || !Number.isFinite(score)) return null
  const s = Math.round(score)
  if (s >= 85) return 'A'
  if (s >= 70) return 'B'
  if (s >= 55) return 'C'
  if (s >= 40) return 'D'
  return 'F'
}

/** @deprecated kept for callers; now delegates to the unified scale. */
export const letterGradeFor = gradeForScore


export interface CoachEvaluation {
  // Overall — null when there is not enough evidence to grade the trade.
  quality_score:    number | null   // 0-100 | null
  strategy_grade:   LetterGrade | null
  confidence:       Confidence
  data_completeness: number          // 0-1 — fraction of the 5 axes with evidence

  emotional_flag:   boolean
  emotional_reason: string | null
  what_worked:      string[]
  what_to_fix:      string[]
  advancement:      string | null
  evaluator_version: number

  // Five process sub-grades — null when that axis has no evidence.
  execution_grade:  number | null
  psychology_grade: number | null
  risk_grade:       number | null
  discipline_grade: number | null
  timing_grade:     number | null
  ai_insights:      string[]

  // Phase 10 — unified platform trust contract for the overall quality score.
  trust:            TrustResult
}

/** coach Confidence → trust-engine TrustConfidence. */
function coachConfidenceToTrust(c: Confidence): TrustConfidence {
  return c === 'high' ? 'High' : c === 'medium' ? 'Medium' : c === 'low' ? 'Low' : 'Insufficient'
}

/** Map a coach evaluation onto the platform TrustResult. Confidence is the
 *  coach's OWN process-completeness signal (not trade sample size); assurance
 *  is Self-Reported (journal fields), so trust_level can never exceed Medium. */
export function coachEvaluationTrust(ev: Pick<CoachEvaluation,
  'quality_score' | 'confidence' | 'data_completeness'>): TrustResult {
  const evidenced = Math.round(ev.data_completeness * 5)   // 0..5 process axes
  return buildTrust({
    metric_id:      'coach_quality',
    value:          ev.quality_score,
    confidence:     coachConfidenceToTrust(ev.confidence),
    sample_size:    1,            // per-trade evaluation
    min_sample:     1,
    evidence_count: evidenced,
    assurance:      'Self-Reported',
    formula:        'Mean of the EVIDENCED process axes (Execution, Psychology, Risk, Discipline, Timing). PnL never enters; zero evidence → Insufficient.',
    inputs_missing: evidenced < 5 ? [`${5 - evidenced} of 5 process axes not logged`] : [],
  })
}


export const EVALUATOR_VERSION = 3


export function evaluateTrade(input: EvaluatorInput): CoachEvaluation {
  const execution  = scoreExecution(input)
  const psychology = scorePsychology(input)
  const risk       = scoreRisk(input)
  const discipline = scoreDiscipline(input)
  const timing     = scoreTiming(input)

  const axes = [execution, psychology, risk, discipline, timing]
  const evidenced = axes.filter((a): a is AxisResult & { score: number } => a.score != null)
  const data_completeness = Math.round((evidenced.length / axes.length) * 100) / 100

  // Overall = mean of EVIDENCED axes only. No baseline, no imputation.
  let quality_score: number | null = null
  let confidence: Confidence = 'insufficient'
  if (evidenced.length > 0) {
    quality_score = Math.round(
      evidenced.reduce((s, a) => s + a.score, 0) / evidenced.length,
    )
    confidence = evidenced.length >= 4 ? 'high'
               : evidenced.length >= 2 ? 'medium'
               : 'low'
  }
  const grade = gradeForScore(quality_score)

  const worked = [
    ...execution.worked, ...psychology.worked, ...risk.worked,
    ...discipline.worked, ...timing.worked,
  ].slice(0, 5)
  const fix = [
    ...execution.fix, ...psychology.fix, ...risk.fix,
    ...discipline.fix, ...timing.fix,
  ].slice(0, 5)

  const emotionalFlag   = psychology.emotionalFlag   ?? false
  const emotionalReason = psychology.emotionalReason ?? null

  const insights = generateTradeInsights({
    input,
    execution: execution.score, psychology: psychology.score, risk: risk.score,
    discipline: discipline.score, timing: timing.score,
    confidence, data_completeness,
  })

  const advancement = computeAdvancement({
    confidence, emotionalFlag,
    execution: execution.score, psychology: psychology.score, risk: risk.score,
    discipline: discipline.score, timing: timing.score, overall: quality_score,
    input,
  })

  return {
    quality_score,
    strategy_grade:    grade,
    confidence,
    data_completeness,
    emotional_flag:    emotionalFlag,
    emotional_reason:  emotionalReason,
    what_worked:       worked,
    what_to_fix:       fix,
    advancement,
    evaluator_version: EVALUATOR_VERSION,
    execution_grade:   execution.score,
    psychology_grade:  psychology.score,
    risk_grade:        risk.score,
    discipline_grade:  discipline.score,
    timing_grade:      timing.score,
    ai_insights:       insights,
    trust:             coachEvaluationTrust({ quality_score, confidence, data_completeness }),
  }
}


// ─── Axis scorers ──────────────────────────────────────────────────
// Each returns score:null when the axis has NO evidence (never a baseline).

interface AxisResult {
  score:           number | null
  worked:          string[]
  fix:             string[]
  emotionalFlag?:  boolean
  emotionalReason?: string | null
}

/** Execution — scored only from the execution-quality ratings actually
 *  logged (weights renormalised over what's present; no imputation). */
function scoreExecution(i: EvaluatorInput): AxisResult {
  const worked: string[] = []
  const fix:    string[] = []
  const parts: Array<[number, number]> = []   // [value, weight]
  const eq = qualityScore(i.entry_quality)
  const xq = qualityScore(i.exit_quality)
  const mq = qualityScore(i.management_quality)
  if (eq != null) parts.push([eq, 0.35])
  if (mq != null) parts.push([mq, 0.35])
  if (xq != null) parts.push([xq, 0.30])

  if (parts.length === 0) {
    fix.push('Execution quality not rated — score entry, exit, and management to enable execution analytics.')
    return { score: null, worked, fix }   // ← Insufficient Data, NOT 55
  }
  const wsum = parts.reduce((s, [, w]) => s + w, 0)
  const score = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wsum)

  if ((eq ?? 0) >= 80) worked.push(`Entry quality rated ${i.entry_quality} — high-precision execution.`)
  if ((mq ?? 0) >= 80) worked.push('Trade management rated strong — kept the plan through the noise.')
  if (eq != null && eq < 50) fix.push(`Entry quality rated ${i.entry_quality} — review what made it sloppy.`)
  if (xq != null && xq < 50) fix.push(`Exit quality rated ${i.exit_quality} — early/late exits leak edge.`)

  return { score: clamp(score), worked, fix }
}

/** Psychology — needs at least one logged psychological signal. */
function scorePsychology(i: EvaluatorInput): AxisResult {
  const worked: string[] = []
  const fix:    string[] = []
  let emotionalFlag = false
  let emotionalReason: string | null = null

  const pre = (i.emotion_pre ?? '').toLowerCase()
  const rfe = (i.reason_for_entry ?? '').toLowerCase()
  const hasEvidence = !!pre || !!rfe || i.revenge_trade != null || i.confidence_level != null
  if (!hasEvidence) {
    fix.push('Emotional state not logged — capture emotion_pre + reason_for_entry so psychology analytics turn on.')
    return { score: null, worked, fix }   // ← Insufficient Data, NOT 56
  }

  let score = 60   // neutral anchor — only reached once there IS evidence
  if (pre) {
    if (pre === 'calm' || pre === 'focused' || pre === 'confident' || pre.includes('focus')) {
      score += 18; worked.push(`Entered ${pre} — emotional baseline supports execution.`)
    } else if (pre === 'fomo' || pre.includes('fomo')) {
      score -= 25; emotionalFlag = true; emotionalReason = 'Pre-trade FOMO'
      fix.push('Pre-trade FOMO flagged — pause 15 min and re-validate the setup before any retake.')
    } else if (pre === 'anxious' || pre === 'fearful' || pre.includes('fear') || pre.includes('anx')) {
      score -= 18; emotionalFlag = true; emotionalReason = 'Pre-trade fear/anxiety'
      fix.push('Pre-trade fear logged — size down or skip; emotional asymmetry distorts execution.')
    } else if (pre === 'excited' || pre === 'euphoric' || pre.includes('euphor')) {
      score -= 15; emotionalFlag = true; emotionalReason = 'Pre-trade excitement/euphoria'
      fix.push('Excited/euphoric entry — historically followed by overstaying winners and revenge trades.')
    } else if (pre === 'frustrated' || pre === 'angry' || pre.includes('angr')) {
      score -= 28; emotionalFlag = true; emotionalReason = 'Pre-trade frustration/anger'
      fix.push('Frustration or anger before entry — stop trading for the session.')
    }
  }

  if (rfe === 'strategy_signal') { score += 12; worked.push('Entry from a strategy signal — rule-based.') }
  else if (rfe === 'confirmation_setup') { score += 8; worked.push('Confirmation-based entry — quality bias.') }
  else if (rfe === 'news') { score -= 4; fix.push('News-driven entry — verify the playbook covered this regime.') }
  else if (rfe === 'impulse') {
    score -= 18; emotionalFlag = true; emotionalReason = emotionalReason ?? 'Impulse entry'
    fix.push('Impulsive entry — name the specific rule that this trade broke.')
  } else if (rfe === 'fomo') {
    score -= 20; emotionalFlag = true; emotionalReason = emotionalReason ?? 'FOMO entry'
    fix.push('FOMO-tagged entry — sit out the next setup to recalibrate.')
  }

  if (i.revenge_trade === true) {
    score -= 22; emotionalFlag = true; emotionalReason = emotionalReason ?? 'Revenge trade'
    fix.push('Self-identified as a revenge trade — log the trigger (the prior loss) so the pattern surfaces.')
  }

  const conf = i.confidence_level
  const sv   = (i.setup_validity ?? '').toLowerCase()
  if (conf != null && sv) {
    if (sv === 'no' && conf >= 8) { score -= 12; fix.push(`Confidence ${conf}/10 on a setup you marked invalid — overconfidence bias.`) }
    else if (sv === 'yes' && conf <= 4) { score -= 6; fix.push(`Confidence ${conf}/10 on a valid setup — hesitation costs edge.`) }
    else if (sv === 'yes' && conf >= 7) { score += 5; worked.push(`Confidence ${conf}/10 aligned with a valid setup.`) }
  }

  return { score: clamp(score), worked, fix, emotionalFlag, emotionalReason }
}

/** Risk — requires logged risk_pct (fails closed: risk we can't measure is
 *  Insufficient Data, never a passing 54). */
function scoreRisk(i: EvaluatorInput): AxisResult {
  const worked: string[] = []
  const fix:    string[] = []
  const r = i.risk_pct

  if (r == null) {
    fix.push('Risk per trade missing — log risk_pct so the coach can score sizing (risk is never assumed safe).')
    return { score: null, worked, fix }   // ← Insufficient Data, NOT 54
  }

  let score = 60
  if (r <= 0) {
    fix.push('Risk recorded as zero — likely a logging gap; capture risk_pct on every trade.')
    score -= 8
  } else if (r > 5) {
    score -= 30; fix.push(`Risked ${pctStr(r)} on a single trade — far outside the institutional 0.5–1.5% band.`)
  } else if (r > 2) {
    score -= 15; fix.push(`Risked ${pctStr(r)}. Above the 2% retail cap; trim sizing.`)
  } else if (r >= 0.4 && r <= 1.5) {
    score += 18; worked.push(`Risk ${pctStr(r)} sat in the disciplined band.`)
  } else if (r < 0.4) {
    score += 4
  }

  const sv = (i.setup_validity ?? '').toLowerCase()
  if (sv === 'no' && r > 1) { score -= 14; fix.push(`Risked ${pctStr(r)} on an invalid setup — cap to 0.25% or pass.`) }
  else if (sv === 'partial' && r > 1.5) { score -= 6; fix.push(`${pctStr(r)} on a partial setup — half-size partials.`) }

  return { score: clamp(score), worked, fix }
}

/** Discipline — requires a logged compliance/violation/mistake/reflection. */
function scoreDiscipline(i: EvaluatorInput): AxisResult {
  const worked: string[] = []
  const fix:    string[] = []
  const rc = (i.rule_compliance ?? '').toLowerCase()
  const mistakes = Array.isArray(i.mistakes) ? i.mistakes : []
  const hasReflection = !!(i.what_went_well?.trim() || (i.reflection ?? i.improvements ?? '').trim())
  const hasEvidence = !!rc || i.rule_violation != null || mistakes.length > 0 || hasReflection
  if (!hasEvidence) {
    fix.push('Rule compliance not logged — capture it on every trade to make discipline measurable.')
    return { score: null, worked, fix }   // ← Insufficient Data, NOT 61
  }

  let score = 65
  if (rc === 'full') { score += 18; worked.push('Full rule compliance — playbook-aligned trade.') }
  else if (rc === 'partial') { score -= 10; fix.push('Partial rule compliance — name the specific rule that slipped and build a tripwire.') }
  else if (rc === 'none') { score -= 30; fix.push('No rule compliance — this is a freelance trade; classify it, then decide whether the rule needs updating.') }
  else if (i.rule_violation === true) { score -= 22; fix.push('Rule violation logged — investigate which rule and add a tripwire.') }

  if (i.revenge_trade === true) { score -= 14; fix.push('Revenge trade flagged — explicit discipline breach.') }

  if (mistakes.length > 0) {
    score -= Math.min(20, mistakes.length * 5)
    for (const m of mistakes.slice(0, 2)) fix.push(`Logged mistake: ${m}.`)
  }
  if (i.what_went_well && i.what_went_well.trim().length > 0) { score += 5; worked.push('Self-noted what went well — reinforces the rep.') }
  if ((i.reflection ?? i.improvements ?? '').trim().length > 0) { score += 5; worked.push('Captured a reflection — self-awareness is the lever.') }

  return { score: clamp(score), worked, fix }
}

/** Timing — requires setup_validity, a strategy×regime pair, or a session. */
function scoreTiming(i: EvaluatorInput): AxisResult {
  const worked: string[] = []
  const fix:    string[] = []
  const sv = (i.setup_validity ?? '').toLowerCase()
  const strat  = (i.strategy_used ?? '').toLowerCase()
  const regime = (i.market_regime ?? i.market_context ?? '').toLowerCase()
  const sess = (i.session ?? '').toLowerCase()
  const hasEvidence = !!sv || (!!strat && !!regime) || !!sess
  if (!hasEvidence) {
    fix.push('Setup validity / session not rated — log them so timing analytics turn on.')
    return { score: null, worked, fix }   // ← Insufficient Data, NOT 56
  }

  let score = 60
  if (sv === 'yes')      { score += 18; worked.push('Setup conditions valid at entry.') }
  else if (sv === 'partial') { score -= 6; fix.push('Setup only partially valid — wait for full confirmation next time.') }
  else if (sv === 'no')      { score -= 20; fix.push('Setup invalid at entry — this trade was timing without a thesis.') }

  if (strat && regime) {
    const fit = regimeFit(strat, regime)
    if (fit === 'strong')   { score += 10; worked.push(`${labelStrategy(strat)} in a ${regime} regime — strategy-environment fit.`) }
    else if (fit === 'weak'){ score -= 10; fix.push(`${labelStrategy(strat)} in a ${regime} regime — historical mismatch; expect lower win rate.`) }
  }

  if (sess === 'off_hours') { score -= 6; fix.push('Off-hours entry — liquidity gaps amplify slippage; tighter risk needed.') }
  else if (sess === 'overlap') { score += 4; worked.push('Session overlap — liquidity-rich window.') }

  return { score: clamp(score), worked, fix }
}


// ─── Strategy × regime fit table (PRIOR, low confidence) ───────────
function regimeFit(strategy: string, regime: string): 'strong' | 'neutral' | 'weak' {
  const fits: Record<string, Record<string, 'strong' | 'weak'>> = {
    trend_following: { trending: 'strong', ranging: 'weak',     reversal: 'weak'   },
    breakout:        { trending: 'strong', volatile: 'strong',  ranging: 'weak'    },
    scalping:        { ranging:  'strong', volatile: 'weak'                        },
    swing:           { trending: 'strong', low_liquidity: 'weak'                   },
    smc:             { trending: 'strong', reversal: 'strong',  low_liquidity: 'weak' },
    mean_reversion:  { ranging:  'strong', trending: 'weak'                        },
    news:            { volatile: 'strong', low_liquidity: 'weak'                   },
  }
  return fits[strategy]?.[regime] ?? 'neutral'
}

function labelStrategy(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}


// ─── Insight generator ───────────────────────────────────────────
function generateTradeInsights(ctx: {
  input: EvaluatorInput
  execution: number | null; psychology: number | null; risk: number | null
  discipline: number | null; timing: number | null
  confidence: Confidence; data_completeness: number
}): string[] {
  const out: string[] = []
  const i = ctx.input

  // Lead with an honesty statement about how much was logged.
  if (ctx.confidence === 'insufficient') {
    out.push('Insufficient data to grade this trade — log Strategy + Psychology + Risk so the coach can evaluate it.')
  } else if (ctx.confidence === 'low') {
    out.push(`Low-confidence read: only ${Math.round(ctx.data_completeness * 5)} of 5 process areas were logged.`)
  }

  const grades: Array<[string, number | null]> = [
    ['Execution', ctx.execution], ['Psychology', ctx.psychology], ['Risk', ctx.risk],
    ['Discipline', ctx.discipline], ['Timing', ctx.timing],
  ]
  const present = grades.filter((g): g is [string, number] => g[1] != null)
  if (present.length) {
    const best = [...present].sort((a, b) => b[1] - a[1])[0]!
    const worst = [...present].sort((a, b) => a[1] - b[1])[0]!
    if (best[1] >= 70) out.push(`Strongest axis: ${best[0]} (${best[1]}/100) — leaned on the right rep here.`)
    if (worst[1] < 50) out.push(`Weakest axis: ${worst[0]} (${worst[1]}/100) — focus next session.`)
  }

  const pre = (i.emotion_pre ?? '').toLowerCase()
  const pnl = i.pnl
  if (pre && pnl != null) {
    if ((pre === 'fomo' || pre === 'angry' || pre === 'frustrated') && pnl < 0)
      out.push(`${labelStrategy(pre)} entries that lose — recurring pattern. Lock the rule that catches it.`)
    else if ((pre === 'calm' || pre === 'focused' || pre === 'confident') && pnl > 0)
      out.push('Calm or focused entries that win — the rep you want to repeat.')
  }
  if (i.revenge_trade === true) {
    out.push(pnl != null && pnl > 0
      ? 'Revenge trade that worked — the math is biased; the win reinforces a destructive pattern.'
      : 'Revenge trade that lost — the cost of unmanaged emotion.')
  }
  const strat  = (i.strategy_used ?? '').toLowerCase()
  const regime = (i.market_regime ?? i.market_context ?? '').toLowerCase()
  if (strat && regime) {
    const fit = regimeFit(strat, regime)
    if (fit === 'weak') out.push(`${labelStrategy(strat)} in a ${regime} regime is historically low-edge (prior, low confidence) — verify the playbook covers this case.`)
    else if (fit === 'strong') out.push(`${labelStrategy(strat)} in a ${regime} regime is your high-edge environment (prior, low confidence).`)
  }
  const r  = i.risk_pct
  const sv = (i.setup_validity ?? '').toLowerCase()
  if (r != null && r > 1 && sv === 'no') out.push(`Risked ${pctStr(r)} on a setup you marked invalid — the canonical overconfidence leak.`)
  else if (r != null && r > 2) out.push(`Risked ${pctStr(r)} — above the institutional band; one bad streak takes you out.`)

  if (ctx.execution != null && ctx.execution >= 75 && pnl != null && pnl < 0)
    out.push("Clean execution on a losing trade — the cost of doing business. Don't change the process to chase the outcome.")
  else if (ctx.execution != null && ctx.execution <= 45 && pnl != null && pnl > 0)
    out.push('Sloppy execution on a winning trade — the outcome flatters bad process. Tighten the next entry.')

  if (out.length < 3) {
    if (!i.emotion_pre)    out.push('Log emotion_pre on every trade — psychology analytics turn on at ~10 logged entries.')
    if (!i.strategy_used)  out.push('Tag strategy_used — strategy-edge analytics require it.')
    if (!i.setup_validity) out.push('Rate setup_validity — timing analytics depend on it.')
    if (out.length < 3)    out.push('Build the habit of capturing reason_for_entry + reflection on every trade.')
  }
  return out.slice(0, 6)
}


// ─── Advancement (one next step) ────────────────────────────────────
function computeAdvancement(ctx: {
  confidence: Confidence; emotionalFlag: boolean
  execution: number | null; psychology: number | null; risk: number | null
  discipline: number | null; timing: number | null; overall: number | null
  input: EvaluatorInput
}): string {
  if (ctx.confidence === 'insufficient')
    return 'Not enough logged yet to coach this trade. Capture Strategy (setup validity, regime) + Psychology (emotion, reason) + Risk (risk %) — then the grade means something.'
  if (ctx.input.revenge_trade === true)
    return 'Next session: write down what triggered the revenge trade (which loss, how recent) and add the rule that would have stopped it.'
  if (ctx.emotionalFlag)
    return 'Next entry: log emotion_pre BEFORE clicking the order, then read the rule the emotion is biased against. If they conflict, skip.'
  if (ctx.risk != null && ctx.risk < 40)
    return 'Next trade: cap risk to 0.5% and let the strategy prove itself at the disciplined sizing band before scaling.'
  if (ctx.discipline != null && ctx.discipline < 50)
    return 'Pre-trade ritual this week: read the rule for the setup out loud before pulling the trigger.'
  if (ctx.timing != null && ctx.timing < 50)
    return 'Next time you see this setup: wait for setup_validity = yes before entering. Partials underperform.'
  if (ctx.execution != null && ctx.execution < 50)
    return 'Next trade: name what would make entry quality "excellent" before placing the order, then judge afterwards.'
  if (ctx.overall != null && ctx.overall >= 80)
    return 'Strong trade. Capture what made it work in your reflection so it scales.'
  return 'Capture a one-line reflection on this trade — the lever that moves discipline is volume of reps × honesty in the review.'
}


// ─── Helpers ────────────────────────────────────────────────────────
function qualityScore(label: string | null | undefined): number | null {
  if (!label) return null
  switch (label.toLowerCase()) {
    case 'excellent': return 92
    case 'good':      return 75
    case 'average':   return 55
    case 'poor':      return 30
    default:          return null
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function pctStr(r: number): string {
  return `${r.toFixed(2)}%`
}
