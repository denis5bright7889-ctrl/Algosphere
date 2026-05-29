/**
 * Deterministic per-trade coach evaluator (Refocus R4b).
 *
 * Complements the existing LLM-driven `journal_entries.ai_review` —
 * that one calls Gemini, can fail, and gives free-form text. This one
 * is pure-function, never fails, and emits structured fields the
 * Trader Intelligence dashboard renders without LLM dependency.
 *
 * Called from the journal write path after a successful insert. The
 * row is upserted into `journal_coach_evaluations` (one row per
 * evaluator run, latest wins on display).
 *
 * Scoring axes (each contributes to the 0–100 quality_score):
 *   - rule_violation       —  −25 if true
 *   - risk_pct             —  penalised when above 2 % (over-risking)
 *                          —  rewarded around 0.5–1.5 % (institutional band)
 *   - emotion_pre          —  bonus for calm / focused, penalty for FOMO / fear / angry
 *   - mistakes[]           —  −5 each (capped)
 *   - what_went_well       —  +5 if non-empty
 *   - improvements         —  +5 if non-empty (self-awareness signal)
 *   - PnL outcome          —  bonus when positive, but only when risk_pct is sane
 *   - setup_tag present    —  +3 (the trader has named the playbook)
 *
 * Letter grade derives from quality_score bands.
 */

export interface EvaluatorInput {
  /** Journal row fields we care about. All optional — every score is
   *  derived from "what's present and what isn't". */
  pnl?:            number | null
  pips?:           number | null
  risk_pct?:       number | null
  risk_amount?:    number | null
  rule_violation?: boolean | null
  emotion_pre?:    string | null
  emotion_post?:   string | null
  mistakes?:       string[] | null
  what_went_well?: string | null
  improvements?:   string | null
  setup_tag?:      string | null
  pair?:           string | null
  direction?:      string | null
  notes?:          string | null
  regime_at_entry?: string | null
}


export interface CoachEvaluation {
  quality_score:    number   // 0–100
  strategy_grade:   'A' | 'B' | 'C' | 'D' | 'F'
  emotional_flag:   boolean
  emotional_reason: string | null
  what_worked:      string[]   // bounded
  what_to_fix:      string[]   // bounded
  advancement:      string | null
  evaluator_version: number
}


export const EVALUATOR_VERSION = 1


export function evaluateTrade(input: EvaluatorInput): CoachEvaluation {
  let score = 50 // neutral baseline; each axis nudges up or down
  const worked: string[] = []
  const fix:    string[] = []

  // ── Rule violations are the most expensive signal ───────────────
  if (input.rule_violation === true) {
    score -= 25
    fix.push('Rule violation logged — investigate which rule and add a tripwire.')
  }

  // ── Risk sizing ──────────────────────────────────────────────────
  const r = input.risk_pct
  if (r != null) {
    if (r <= 0) {
      fix.push('Risk recorded as zero — likely a logging gap; capture risk_pct on every trade.')
    } else if (r > 5) {
      score -= 20
      fix.push(`Risked ${pct(r / 100)} on a single trade — far outside the institutional 0.5–1.5 % band.`)
    } else if (r > 2) {
      score -= 10
      fix.push(`Risked ${pct(r / 100)}. Above the 2 % retail cap; trim sizing.`)
    } else if (r >= 0.4 && r <= 1.5) {
      score += 8
      worked.push(`Risk ${pct(r / 100)} sat in the disciplined band.`)
    } else if (r < 0.4) {
      score += 2  // under-risking isn't terrible but doesn't compound capital
    }
  } else {
    fix.push('Risk per trade missing — log risk_pct so the coach can score sizing.')
    score -= 3
  }

  // ── Emotion-pre ──────────────────────────────────────────────────
  let emotionalFlag = false
  let emotionalReason: string | null = null
  const pre = (input.emotion_pre ?? '').toLowerCase()
  if (pre) {
    if (pre === 'calm' || pre === 'confident' || pre.includes('focus')) {
      score += 6
      worked.push(`Entered ${pre} — emotional baseline supports execution.`)
    } else if (pre === 'fomo' || pre.includes('fomo') || pre.includes('rush')) {
      score -= 12
      emotionalFlag = true
      emotionalReason = 'Pre-trade FOMO'
      fix.push('Pre-trade FOMO flagged — pause 15 min and re-validate the setup.')
    } else if (pre === 'fearful' || pre.includes('fear') || pre.includes('anx')) {
      score -= 8
      emotionalFlag = true
      emotionalReason = 'Pre-trade fear/anxiety'
      fix.push('Pre-trade fear logged — size down or skip; emotional asymmetry distorts execution.')
    } else if (pre === 'euphoric' || pre.includes('euphor')) {
      score -= 10
      emotionalFlag = true
      emotionalReason = 'Pre-trade euphoria'
      fix.push('Euphoric entry — historically followed by overstaying winners and revenge trades.')
    } else if (pre === 'angry' || pre.includes('angr')) {
      score -= 15
      emotionalFlag = true
      emotionalReason = 'Pre-trade anger'
      fix.push('Anger before entry — stop trading for the day.')
    }
  }

  // ── Mistakes / strengths / self-coaching ────────────────────────
  const mistakes = Array.isArray(input.mistakes) ? input.mistakes : []
  if (mistakes.length > 0) {
    const penalty = Math.min(15, mistakes.length * 5)
    score -= penalty
    for (const m of mistakes.slice(0, 3)) {
      fix.push(`Logged mistake: ${m}.`)
    }
  }

  if (input.what_went_well && input.what_went_well.trim().length > 0) {
    score += 5
    worked.push('Self-noted what went well — reinforces the rep.')
  }
  if (input.improvements && input.improvements.trim().length > 0) {
    score += 5
    worked.push('Captured an improvement — self-awareness is the lever.')
  }

  // ── Setup tag presence ──────────────────────────────────────────
  if (input.setup_tag && input.setup_tag.trim().length > 0) {
    score += 3
    worked.push(`Setup named (${input.setup_tag}) — playbook-aware execution.`)
  } else {
    fix.push('Setup tag missing — name the playbook so segment analytics can score it.')
  }

  // ── Outcome ─────────────────────────────────────────────────────
  // Reward winners ONLY when sizing was sane — a win on 5%+ risk is
  // not a virtue, it's a tax-on-future-self.
  const pnl = input.pnl
  if (pnl != null && Number.isFinite(pnl)) {
    if (pnl > 0 && (r == null || r <= 2)) {
      score += 8
      worked.push('Closed in profit with disciplined sizing.')
    } else if (pnl > 0 && r != null && r > 2) {
      score += 2
      fix.push('Profit on oversized risk — the outcome flatters poor process.')
    } else if (pnl < 0 && (r == null || r <= 2)) {
      // Losing trades within size aren't penalised; they are the cost
      // of executing edge.
      worked.push('Loss within sizing budget — cost of doing business.')
    } else if (pnl < 0 && r != null && r > 2) {
      score -= 5
      fix.push('Loss on oversized risk — compounds the discipline issue.')
    }
  }

  // ── Final clamp + grade ─────────────────────────────────────────
  score = Math.max(0, Math.min(100, Math.round(score)))
  const grade =
    score >= 85 ? 'A' :
    score >= 70 ? 'B' :
    score >= 55 ? 'C' :
    score >= 40 ? 'D' : 'F'

  // ── Advancement — one concrete next step ───────────────────────
  const advancement = computeAdvancement({
    grade, score, emotionalFlag, mistakes,
    riskPct: r ?? null,
    hasSetup: Boolean(input.setup_tag),
    didReflect: Boolean(input.improvements || input.what_went_well),
  })

  return {
    quality_score:    score,
    strategy_grade:   grade,
    emotional_flag:   emotionalFlag,
    emotional_reason: emotionalReason,
    what_worked:      worked.slice(0, 5),
    what_to_fix:      fix.slice(0, 5),
    advancement,
    evaluator_version: EVALUATOR_VERSION,
  }
}


function computeAdvancement(ctx: {
  grade: string; score: number; emotionalFlag: boolean
  mistakes: string[]; riskPct: number | null
  hasSetup: boolean; didReflect: boolean
}): string {
  if (ctx.emotionalFlag) {
    return 'Next session: write the rule that would have stopped this entry, and add it to your pre-trade checklist.'
  }
  if (ctx.riskPct != null && ctx.riskPct > 2) {
    return 'Next trade: cut position size by half and let the strategy prove itself at the disciplined sizing band.'
  }
  if (ctx.mistakes.length >= 2) {
    return `Pick the one mistake to eliminate this week: ${ctx.mistakes[0]}.`
  }
  if (!ctx.hasSetup) {
    return 'Next entry: name the setup tag before taking the trade. Untagged trades cannot improve.'
  }
  if (!ctx.didReflect) {
    return 'Next trade: spend 60 seconds noting one thing that worked and one to improve. That single rep is the lever.'
  }
  if (ctx.grade === 'A' || ctx.grade === 'B') {
    return 'Repeat this exact pre-trade routine on the next setup — the framework is working.'
  }
  return 'Stay small until the routine stabilises. Quality > quantity at this stage.'
}


function pct(v: number): string {
  return `${Math.round(v * 100 * 10) / 10}%`
}
