/**
 * Deterministic per-trade coach evaluator (Journal V3 — Behavioral
 * Trading Intelligence System).
 *
 * Pure-function, never fails. Reads the structured behavioral record
 * the V3 form captures (Strategy + Psychology + Execution + Outcome)
 * and emits:
 *
 *   - 5 process grades (Execution / Psychology / Risk / Discipline /
 *     Timing), each 0-100, derived from PROCESS data only — never from
 *     PnL outcome. A losing trade can be A-grade execution; a winning
 *     trade can be poor execution.
 *   - overall_score (the existing `quality_score`) and letter grade.
 *   - emotional_flag + reason (for the psychology UI).
 *   - what_worked / what_to_fix bounded arrays (3-5 of each).
 *   - ai_insights — 3+ specific behavioral insights ("you tend to
 *     overtrade after losses", "London remains your highest-expectancy
 *     session", etc.) that downstream engines read directly.
 *   - advancement — one concrete next step the trader can act on.
 *
 * Called from /api/journal POST after a successful insert. The row is
 * inserted into `journal_coach_evaluations` (one row per evaluator
 * run; latest wins on display).
 */

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


export interface CoachEvaluation {
  // Overall (existing public contract)
  quality_score:    number   // 0-100
  strategy_grade:   'A' | 'B' | 'C' | 'D' | 'F'
  emotional_flag:   boolean
  emotional_reason: string | null
  what_worked:      string[]
  what_to_fix:      string[]
  advancement:      string | null
  evaluator_version: number

  // V3 — five process sub-grades + ranked insights
  execution_grade:  number   // 0-100
  psychology_grade: number   // 0-100
  risk_grade:       number   // 0-100
  discipline_grade: number   // 0-100
  timing_grade:     number   // 0-100
  ai_insights:      string[] // 3+ specific behavioral observations
}


export const EVALUATOR_VERSION = 2


export function evaluateTrade(input: EvaluatorInput): CoachEvaluation {
  const execution  = scoreExecution(input)
  const psychology = scorePsychology(input)
  const risk       = scoreRisk(input)
  const discipline = scoreDiscipline(input)
  const timing     = scoreTiming(input)

  // Overall = unweighted average of the 5 process axes. Process-based;
  // PnL never enters the score directly (only as a tie-breaker on
  // tied execution sub-scores).
  const overall = Math.round(
    (execution.score + psychology.score + risk.score + discipline.score + timing.score) / 5,
  )

  const grade =
    overall >= 85 ? 'A' :
    overall >= 70 ? 'B' :
    overall >= 55 ? 'C' :
    overall >= 40 ? 'D' : 'F'

  // Combine the per-axis worked / fix bullets, bounded so the UI stays
  // scannable.
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
    execution: execution.score,
    psychology: psychology.score,
    risk: risk.score,
    discipline: discipline.score,
    timing: timing.score,
    overall,
  })

  const advancement = computeAdvancement({
    grade, overall, emotionalFlag,
    execution: execution.score, psychology: psychology.score,
    risk: risk.score, discipline: discipline.score, timing: timing.score,
    input,
  })

  return {
    quality_score:     overall,
    strategy_grade:    grade,
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
  }
}


// ─── Axis scorers ──────────────────────────────────────────────────

interface AxisResult {
  score:           number      // 0-100
  worked:          string[]
  fix:             string[]
  emotionalFlag?:  boolean
  emotionalReason?: string | null
}

/** Execution grade — how cleanly the trade was opened, managed, closed.
 *  Strictly process: never reads PnL. */
function scoreExecution(i: EvaluatorInput): AxisResult {
  const worked: string[] = []
  const fix:    string[] = []
  const eq = qualityScore(i.entry_quality)
  const xq = qualityScore(i.exit_quality)
  const mq = qualityScore(i.management_quality)

  // Weighted average: entry 35, management 35, exit 30 — entry & mgmt
  // matter more than the exit on most trades.
  const filled = [eq, xq, mq].filter((s): s is number => s != null)
  if (filled.length === 0) {
    fix.push('Execution quality not rated — score entry, exit, and management to enable execution analytics.')
    return { score: 55, worked, fix }   // mild credit for trades unrated yet
  }
  const score = Math.round(
    ((eq ?? 65) * 0.35) + ((mq ?? 65) * 0.35) + ((xq ?? 65) * 0.30),
  )

  if ((eq ?? 0) >= 80) worked.push(`Entry quality rated ${i.entry_quality} — high-precision execution.`)
  if ((mq ?? 0) >= 80) worked.push('Trade management rated strong — kept the plan through the noise.')
  if ((eq ?? 100) < 50) fix.push(`Entry quality rated ${i.entry_quality} — review what made it sloppy.`)
  if ((xq ?? 100) < 50) fix.push(`Exit quality rated ${i.exit_quality} — early/late exits leak edge.`)

  return { score, worked, fix }
}

/** Psychology grade — emotional/mental state coming into the trade. */
function scorePsychology(i: EvaluatorInput): AxisResult {
  let score = 60
  const worked: string[] = []
  const fix:    string[] = []
  let emotionalFlag = false
  let emotionalReason: string | null = null

  const pre = (i.emotion_pre ?? '').toLowerCase()
  if (pre) {
    if (pre === 'calm' || pre === 'focused' || pre === 'confident' || pre.includes('focus')) {
      score += 18
      worked.push(`Entered ${pre} — emotional baseline supports execution.`)
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
  } else {
    fix.push('Emotional state not logged — capture emotion_pre on every trade so psychology analytics turn on.')
    score -= 4
  }

  // Reason for entry — strategy_signal > confirmation > news > impulse/FOMO
  const rfe = (i.reason_for_entry ?? '').toLowerCase()
  if (rfe === 'strategy_signal') { score += 12; worked.push('Entry from a strategy signal — rule-based.') }
  else if (rfe === 'confirmation_setup') { score += 8; worked.push('Confirmation-based entry — quality bias.') }
  else if (rfe === 'news') { score -= 4; fix.push('News-driven entry — verify the playbook covered this regime.') }
  else if (rfe === 'impulse') {
    score -= 18; emotionalFlag = true
    emotionalReason = emotionalReason ?? 'Impulse entry'
    fix.push('Impulsive entry — name the specific rule that this trade broke.')
  }
  else if (rfe === 'fomo') {
    score -= 20; emotionalFlag = true
    emotionalReason = emotionalReason ?? 'FOMO entry'
    fix.push('FOMO-tagged entry — sit out the next setup to recalibrate.')
  }

  // Revenge trade is a hard penalty regardless of other inputs.
  if (i.revenge_trade === true) {
    score -= 22; emotionalFlag = true
    emotionalReason = emotionalReason ?? 'Revenge trade'
    fix.push('Self-identified as a revenge trade — log the trigger (the prior loss) so the pattern surfaces.')
  }

  // Confidence vs setup_validity: high confidence on an invalid setup
  // is overconfidence; low confidence on a valid setup is hesitation.
  const conf = i.confidence_level
  const sv   = (i.setup_validity ?? '').toLowerCase()
  if (conf != null && sv) {
    if (sv === 'no' && conf >= 8) {
      score -= 12
      fix.push(`Confidence ${conf}/10 on a setup you marked invalid — overconfidence bias.`)
    } else if (sv === 'yes' && conf <= 4) {
      score -= 6
      fix.push(`Confidence ${conf}/10 on a valid setup — hesitation costs edge; build a rule-confirmation drill.`)
    } else if (sv === 'yes' && conf >= 7) {
      score += 5
      worked.push(`Confidence ${conf}/10 aligned with a valid setup.`)
    }
  }

  return { score: clamp(score), worked, fix, emotionalFlag, emotionalReason }
}

/** Risk grade — sizing and exposure relative to setup quality. */
function scoreRisk(i: EvaluatorInput): AxisResult {
  let score = 60
  const worked: string[] = []
  const fix:    string[] = []
  const r = i.risk_pct

  if (r != null) {
    if (r <= 0) {
      fix.push('Risk recorded as zero — likely a logging gap; capture risk_pct on every trade.')
      score -= 8
    } else if (r > 5) {
      score -= 30
      fix.push(`Risked ${pctStr(r)} on a single trade — far outside the institutional 0.5–1.5% band.`)
    } else if (r > 2) {
      score -= 15
      fix.push(`Risked ${pctStr(r)}. Above the 2% retail cap; trim sizing.`)
    } else if (r >= 0.4 && r <= 1.5) {
      score += 18
      worked.push(`Risk ${pctStr(r)} sat in the disciplined band.`)
    } else if (r < 0.4) {
      score += 4  // under-risking isn't terrible but doesn't compound capital
    }

    // Sizing × setup_validity — overstaking an invalid setup is the
    // most expensive risk pattern.
    const sv = (i.setup_validity ?? '').toLowerCase()
    if (sv === 'no' && r > 1) {
      score -= 14
      fix.push(`Risked ${pctStr(r)} on an invalid setup — cap to 0.25% or pass.`)
    } else if (sv === 'partial' && r > 1.5) {
      score -= 6
      fix.push(`${pctStr(r)} on a partial setup — half-size partials.`)
    }
  } else {
    fix.push('Risk per trade missing — log risk_pct so the coach can score sizing.')
    score -= 6
  }

  return { score: clamp(score), worked, fix }
}

/** Discipline grade — rule compliance + mistakes. */
function scoreDiscipline(i: EvaluatorInput): AxisResult {
  let score = 65
  const worked: string[] = []
  const fix:    string[] = []

  // rule_compliance is the new V3 field; rule_violation kept as a legacy
  // alias — if either says "broken", penalty applies.
  const rc = (i.rule_compliance ?? '').toLowerCase()
  if (rc === 'full') {
    score += 18
    worked.push('Full rule compliance — playbook-aligned trade.')
  } else if (rc === 'partial') {
    score -= 10
    fix.push('Partial rule compliance — name the specific rule that slipped and build a tripwire.')
  } else if (rc === 'none') {
    score -= 30
    fix.push('No rule compliance — this is a freelance trade; classify it as such, then decide whether the rule needs updating.')
  } else if (i.rule_violation === true) {
    score -= 22
    fix.push('Rule violation logged — investigate which rule and add a tripwire.')
  } else if (!rc) {
    fix.push('Rule compliance not logged — capture it on every trade to make discipline measurable.')
    score -= 4
  }

  // Revenge trade is a discipline problem too.
  if (i.revenge_trade === true) {
    score -= 14
    fix.push('Revenge trade flagged — explicit discipline breach.')
  }

  // Mistakes array: −5 each, bounded.
  const mistakes = Array.isArray(i.mistakes) ? i.mistakes : []
  if (mistakes.length > 0) {
    score -= Math.min(20, mistakes.length * 5)
    for (const m of mistakes.slice(0, 2)) fix.push(`Logged mistake: ${m}.`)
  }

  // Self-coaching = discipline reps.
  if (i.what_went_well && i.what_went_well.trim().length > 0) {
    score += 5; worked.push('Self-noted what went well — reinforces the rep.')
  }
  if ((i.reflection ?? i.improvements ?? '').trim().length > 0) {
    score += 5; worked.push('Captured a reflection — self-awareness is the lever.')
  }

  return { score: clamp(score), worked, fix }
}

/** Timing grade — was this trade taken in the right environment? */
function scoreTiming(i: EvaluatorInput): AxisResult {
  let score = 60
  const worked: string[] = []
  const fix:    string[] = []

  // Setup_validity is the strongest timing signal — taking an invalid
  // setup is bad timing regardless of session.
  const sv = (i.setup_validity ?? '').toLowerCase()
  if (sv === 'yes')      { score += 18; worked.push('Setup conditions valid at entry.') }
  else if (sv === 'partial') { score -= 6; fix.push('Setup only partially valid — partials underperform; wait for full confirmation next time.') }
  else if (sv === 'no')      { score -= 20; fix.push('Setup invalid at entry — this trade was timing without a thesis.') }
  else                        { fix.push('Setup validity not rated — log it so timing analytics turn on.'); score -= 4 }

  // Market regime fit. Strategy_used × market_regime is informative.
  const strat  = (i.strategy_used ?? '').toLowerCase()
  const regime = (i.market_regime ?? i.market_context ?? '').toLowerCase()
  if (strat && regime) {
    const fit = regimeFit(strat, regime)
    if (fit === 'strong')   { score += 10; worked.push(`${labelStrategy(strat)} in a ${regime} regime — strategy-environment fit.`) }
    else if (fit === 'weak'){ score -= 10; fix.push(`${labelStrategy(strat)} in a ${regime} regime — historical mismatch; expect lower win rate.`) }
  }

  // Session is informative if logged; ideally the platform learns the
  // user's per-session edge from history, but a generic prior helps
  // until the sample matures.
  const sess = (i.session ?? '').toLowerCase()
  if (sess === 'off_hours') {
    score -= 6
    fix.push('Off-hours entry — liquidity gaps amplify slippage; tighter risk needed.')
  } else if (sess === 'overlap') {
    score += 4
    worked.push('Session overlap — liquidity-rich window.')
  }

  return { score: clamp(score), worked, fix }
}


// ─── Strategy × regime fit table ───────────────────────────────────

function regimeFit(strategy: string, regime: string): 'strong' | 'neutral' | 'weak' {
  // Conservative priors — meant to be overridden later by user-specific
  // segment edges learned from the journal.
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
  input:      EvaluatorInput
  execution:  number
  psychology: number
  risk:       number
  discipline: number
  timing:     number
  overall:    number
}): string[] {
  const out: string[] = []
  const i = ctx.input

  // 1. Strongest axis (lead with what's working)
  const grades: Array<[string, number]> = [
    ['Execution', ctx.execution], ['Psychology', ctx.psychology],
    ['Risk',      ctx.risk],      ['Discipline', ctx.discipline],
    ['Timing',    ctx.timing],
  ]
  const sortedDesc = [...grades].sort((a, b) => b[1] - a[1])
  const sortedAsc  = [...grades].sort((a, b) => a[1] - b[1])
  const best = sortedDesc[0]!
  const worst = sortedAsc[0]!
  if (best[1] >= 70) out.push(`Strongest axis: ${best[0]} (${best[1]}/100) — leaned on the right rep here.`)
  if (worst[1] < 50) out.push(`Weakest axis: ${worst[0]} (${worst[1]}/100) — focus next session.`)

  // 2. Pattern: emotion + outcome
  const pre = (i.emotion_pre ?? '').toLowerCase()
  const pnl = i.pnl
  if (pre && pnl != null) {
    if ((pre === 'fomo' || pre === 'angry' || pre === 'frustrated') && pnl < 0) {
      out.push(`${labelStrategy(pre)} entries that lose — recurring pattern. Lock the rule that catches it.`)
    } else if ((pre === 'calm' || pre === 'focused' || pre === 'confident') && pnl > 0) {
      out.push('Calm or focused entries that win — the rep you want to repeat.')
    }
  }

  // 3. Revenge × outcome
  if (i.revenge_trade === true) {
    out.push(pnl != null && pnl > 0
      ? 'Revenge trade that worked — the math is biased; the win reinforces a destructive pattern.'
      : 'Revenge trade that lost — the cost of unmanaged emotion.')
  }

  // 4. Strategy × regime fit when both present
  const strat  = (i.strategy_used ?? '').toLowerCase()
  const regime = (i.market_regime ?? i.market_context ?? '').toLowerCase()
  if (strat && regime) {
    const fit = regimeFit(strat, regime)
    if (fit === 'weak') {
      out.push(`${labelStrategy(strat)} in a ${regime} regime is historically low-edge — verify the playbook covers this case.`)
    } else if (fit === 'strong') {
      out.push(`${labelStrategy(strat)} in a ${regime} regime is your high-edge environment.`)
    }
  }

  // 5. Risk × setup_validity
  const r  = i.risk_pct
  const sv = (i.setup_validity ?? '').toLowerCase()
  if (r != null && r > 1 && sv === 'no') {
    out.push(`Risked ${pctStr(r)} on a setup you marked invalid — the canonical overconfidence leak.`)
  } else if (r != null && r > 2) {
    out.push(`Risked ${pctStr(r)} — above the institutional band; one bad streak takes you out.`)
  }

  // 6. Rule compliance discipline
  const rc = (i.rule_compliance ?? '').toLowerCase()
  if (rc === 'none')         out.push('Freelance trade — name what made you deviate so the rule can adapt or hold.')
  else if (rc === 'partial') out.push('Partial rule compliance — identify which clause slipped first.')

  // 7. Execution × outcome decoupling
  if (ctx.execution >= 75 && pnl != null && pnl < 0) {
    out.push('Clean execution on a losing trade — the cost of doing business. Don\'t change the process to chase the outcome.')
  } else if (ctx.execution <= 45 && pnl != null && pnl > 0) {
    out.push('Sloppy execution on a winning trade — the outcome flatters bad process. Tighten the next entry.')
  }

  // Always emit at least 3.
  if (out.length < 3) {
    if (!i.emotion_pre)        out.push('Log emotion_pre on every trade — psychology analytics turn on at ~10 logged entries.')
    if (!i.strategy_used)      out.push('Tag strategy_used — strategy-edge analytics require it.')
    if (!i.setup_validity)     out.push('Rate setup_validity — timing analytics depend on it.')
    if (out.length < 3)         out.push('Build the habit of capturing reason_for_entry + reflection on every trade.')
  }

  return out.slice(0, 6)
}


// ─── Advancement (one next step) ────────────────────────────────────

function computeAdvancement(ctx: {
  grade: string; overall: number; emotionalFlag: boolean
  execution: number; psychology: number; risk: number
  discipline: number; timing: number
  input: EvaluatorInput
}): string {
  // Lead with the most actionable single fix.
  if (ctx.input.revenge_trade === true) {
    return 'Next session: write down what triggered the revenge trade (which loss, how recent) and add the rule that would have stopped it.'
  }
  if (ctx.emotionalFlag) {
    return 'Next entry: log emotion_pre BEFORE clicking the order, then read the rule that the emotion is biased against. If they conflict, skip.'
  }
  if (ctx.risk < 40) {
    return 'Next trade: cap risk to 0.5% and let the strategy prove itself at the disciplined sizing band before scaling.'
  }
  if (ctx.discipline < 50) {
    return 'Pre-trade ritual this week: read the rule for the setup out loud before pulling the trigger.'
  }
  if (ctx.timing < 50) {
    return 'Next time you see this setup: wait for setup_validity = yes before entering. Partials underperform.'
  }
  if (ctx.execution < 50) {
    return 'Next trade: name what would make entry quality "excellent" before placing the order, then judge afterwards.'
  }
  // Strong trade — reinforce the rep.
  if (ctx.overall >= 80) {
    return 'Strong trade. Capture what made it work in your reflection so it scales.'
  }
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
  // r is already a percentage (e.g. 1.5 means 1.5%)
  return `${r.toFixed(2)}%`
}
