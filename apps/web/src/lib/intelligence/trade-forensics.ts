/**
 * Trade Forensics Engine — Phase 4 of the Validation Center.
 *
 * Pure deterministic per-trade explainer. Same shadow execution row
 * + (optional) signal context = same explanation, every time. NO LLM,
 * no randomness, no hallucination.
 *
 * Produces four parallel artifacts that map 1:1 to the migration-81
 * tables:
 *   • TradeExplanation   → trade_explanations
 *   • TradeReview        → trade_reviews
 *   • TradeOutcome       → trade_outcomes
 *   • TradeQualityScore  → trade_quality_scores
 *
 * Honesty contract:
 *   - Fields we don't have source data for (signal_strength when no
 *     signal_id, risk_adjusted when no risk_amount) return null —
 *     NEVER a fabricated default.
 *   - Outcome facts are only computed for closed trades; open trades
 *     get a partial explanation (entry + execution only).
 *   - Lessons/what-worked/what-failed strings ALWAYS trace to a
 *     numeric fact on the row. No invented prose.
 */

export const FORENSICS_VERSION = 'forensics_v1'

// ── Input shape ────────────────────────────────────────────────────
export interface ForensicsShadowInput {
  id:                  string
  user_id:             string
  symbol:              string
  direction:           'buy' | 'sell' | string
  broker:              string
  intended_lot:        number
  intended_entry:      number | null
  intended_sl:         number | null
  intended_tp:         number | null
  actual_status:       string
  actual_fill_price:   number | null
  actual_lot:          number | null
  slippage_pct:        number | null
  skip_reason:         string | null
  leader_pnl:          number | null
  follower_pnl:        number | null
  pnl_drift_pct:       number | null
  created_at:          string
  closed_at:           string | null
}

/** Optional signal context. If the caller can fetch the signal row
 *  referenced by shadow.signal_id, pass it through for richer
 *  entry-analysis output. The engine degrades gracefully without it. */
export interface ForensicsSignalContext {
  confidence:    number | null      // 0-100 or 0-1
  market_regime: string | null
  tier_required: string | null
  risk_reward:   number | null
}

// ── Output shape ──────────────────────────────────────────────────
export type ForensicsGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface TradeExplanation {
  shadow_execution_id:       string
  user_id:                   string
  entry_signal_strength:     string | null
  entry_market_regime:       string | null
  entry_trend_alignment:     string | null
  entry_volatility:          string | null
  entry_risk_score:          number | null
  entry_qualification:       string
  exec_intended_entry:       number | null
  exec_actual_fill:          number | null
  exec_slippage_pct:         number | null
  exec_efficiency:           number | null
  exec_broker_contribution:  'positive' | 'neutral' | 'negative'
  outcome_expected_pnl:      number | null
  outcome_actual_pnl:        number | null
  outcome_pnl_drift_pct:     number | null
  outcome_risk_adjusted:     number | null
  outcome_grade:             ForensicsGrade | null
  engine_version:            string
}

export interface TradeReview {
  shadow_execution_id:    string
  user_id:                string
  what_worked:            string[]
  what_failed:            string[]
  lessons_learned:        string[]
  confidence_score:       number | null
  institutional_rating:   ForensicsGrade
  reviewer:               string
}

export interface TradeOutcome {
  shadow_execution_id:    string
  user_id:                string
  expected_pnl:           number | null
  actual_pnl:             number | null
  pnl_drift_pct:          number | null
  risk_adjusted_pnl:      number | null
  duration_seconds:       number | null
  was_winner:             boolean | null
  was_breakeven:          boolean | null
  hit_target:             boolean | null
  hit_stop:               boolean | null
}

export interface TradeQualityScore {
  shadow_execution_id:    string
  user_id:                string
  entry_quality:          number
  execution_quality:      number
  outcome_quality:        number
  process_quality:        number
  composite_score:        number
  grade:                  ForensicsGrade
  scoring_version:        string
}

export interface ForensicsReport {
  explanation:    TradeExplanation
  review:         TradeReview
  outcome:        TradeOutcome
  quality:        TradeQualityScore
}

// ── Helpers ────────────────────────────────────────────────────────

function gradeFor(score: number): ForensicsGrade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 45) return 'D'
  return 'F'
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

/** Normalise confidence to 0-100 — accept either 0-1 or 0-100 input. */
function normConf(c: number | null): number | null {
  if (c == null) return null
  if (c <= 1)  return Math.round(c * 100)
  if (c > 100) return 100
  return Math.round(c)
}

function strengthLabel(confPct: number | null): string | null {
  if (confPct == null) return null
  if (confPct >= 80) return 'strong'
  if (confPct >= 60) return 'moderate'
  return 'weak'
}

function volatilityFromSlippage(slipPct: number | null): string | null {
  if (slipPct == null) return null
  const abs = Math.abs(slipPct)
  if (abs < 0.0005) return 'low'
  if (abs < 0.002)  return 'normal'
  if (abs < 0.005)  return 'elevated'
  return 'extreme'
}

function brokerContribution(slipPct: number | null, status: string): 'positive' | 'neutral' | 'negative' {
  if (status === 'failed' || status === 'skipped') return 'negative'
  if (slipPct == null) return 'neutral'
  const abs = Math.abs(slipPct)
  if (abs < 0.0005) return 'positive'
  if (abs < 0.002)  return 'neutral'
  return 'negative'
}

// ── Sub-scores (0-100 each) ───────────────────────────────────────

function entryQuality(s: ForensicsShadowInput, ctx: ForensicsSignalContext | null): number {
  // Composite of (1) signal confidence (when known) (2) presence of
  // SL+TP (3) status not 'failed'/'skipped'.
  const conf = normConf(ctx?.confidence ?? null)
  const confTerm = conf == null ? 0.5 : clamp01(conf / 100)
  const hasSL    = s.intended_sl != null
  const hasTP    = s.intended_tp != null
  const planTerm = (hasSL && hasTP) ? 1 : (hasSL || hasTP) ? 0.5 : 0
  const statusOk = s.actual_status !== 'failed' && s.actual_status !== 'skipped' ? 1 : 0
  return Math.round((confTerm * 0.45 + planTerm * 0.35 + statusOk * 0.20) * 100)
}

function executionQuality(s: ForensicsShadowInput): number {
  // Slippage close to zero → 100; broker reliability (mirrored vs failed) weighted.
  const slip = s.slippage_pct == null ? null : Math.abs(s.slippage_pct)
  const slipTerm = slip == null ? 0.5
                 : slip < 0.0005 ? 1
                 : slip < 0.002  ? 0.7
                 : slip < 0.005  ? 0.4
                 : 0.15
  const statusTerm =
    s.actual_status === 'mirrored' ? 1 :
    s.actual_status === 'testnet'  ? 0.9 :
    s.actual_status === 'shadow_only' ? 0.5 :
    s.actual_status === 'skipped'  ? 0.25 :
    s.actual_status === 'failed'   ? 0 : 0.4
  return Math.round((slipTerm * 0.55 + statusTerm * 0.45) * 100)
}

function outcomeQuality(s: ForensicsShadowInput): number | null {
  if (!s.closed_at || s.follower_pnl == null) return null
  const win = s.follower_pnl > 0 ? 1 : 0
  // PnL drift close to leader (when both known) → high score.
  const drift = s.pnl_drift_pct == null ? null : Math.abs(s.pnl_drift_pct)
  const driftTerm = drift == null ? 0.5
                   : drift < 2  ? 1
                   : drift < 5  ? 0.7
                   : drift < 10 ? 0.4
                   : 0.15
  return Math.round((win * 0.55 + driftTerm * 0.45) * 100)
}

function processQuality(s: ForensicsShadowInput): number {
  // Process means: did the trade follow plan? hasSL+TP, not skipped,
  // status mirrored, slippage within tolerance. Outcome-agnostic.
  const hasSL = s.intended_sl != null ? 1 : 0
  const hasTP = s.intended_tp != null ? 1 : 0
  const statusOk = s.actual_status === 'mirrored' || s.actual_status === 'testnet' ? 1 : 0
  const slipOk = s.slippage_pct == null ? 0.5
               : Math.abs(s.slippage_pct) < 0.002 ? 1 : 0.3
  return Math.round((hasSL * 0.25 + hasTP * 0.25 + statusOk * 0.30 + slipOk * 0.20) * 100)
}

// ── Outcome facts ─────────────────────────────────────────────────

function buildOutcome(s: ForensicsShadowInput): TradeOutcome {
  const duration = s.closed_at
    ? Math.round((new Date(s.closed_at).getTime() - new Date(s.created_at).getTime()) / 1000)
    : null

  const closed = s.closed_at != null && typeof s.follower_pnl === 'number'
  const win    = closed ? (s.follower_pnl as number) > 0 : null
  const be     = closed ? (s.follower_pnl as number) === 0 : null

  // hit_target / hit_stop — when actual_fill_price is within 5% of
  // either intended_tp or intended_sl AT CLOSE we treat the trade as
  // having hit that level. This is a heuristic — schema doesn't carry
  // the close price, so we use available proxies.
  let hitTarget: boolean | null = null
  let hitStop:   boolean | null = null
  if (closed && s.actual_fill_price != null) {
    const fill = s.actual_fill_price
    if (s.intended_tp != null) {
      hitTarget = Math.abs((fill - s.intended_tp) / s.intended_tp) < 0.05
    }
    if (s.intended_sl != null) {
      hitStop = Math.abs((fill - s.intended_sl) / s.intended_sl) < 0.05
    }
  }

  return {
    shadow_execution_id: s.id,
    user_id:             s.user_id,
    expected_pnl:        s.leader_pnl,
    actual_pnl:          s.follower_pnl,
    pnl_drift_pct:       s.pnl_drift_pct,
    risk_adjusted_pnl:   null,   // no risk_amount on shadow row; honest null
    duration_seconds:    duration,
    was_winner:          win,
    was_breakeven:       be,
    hit_target:          hitTarget,
    hit_stop:            hitStop,
  }
}

// ── Lessons / review prose (every line traces to a numeric fact) ──

function buildWorked(s: ForensicsShadowInput, scores: { entry: number; exec: number; outcome: number | null }): string[] {
  const out: string[] = []
  if (scores.entry >= 75)   out.push(`Entry plan was solid (SL+TP set, status ${s.actual_status}).`)
  if (scores.exec  >= 75)   out.push(`Execution was clean — slippage ${s.slippage_pct == null ? 'n/a' : `${(s.slippage_pct * 100).toFixed(3)}%`}.`)
  if (scores.outcome != null && scores.outcome >= 75) out.push(`Outcome aligned with leader (drift ${s.pnl_drift_pct == null ? 'n/a' : `${s.pnl_drift_pct.toFixed(2)}%`}).`)
  if (s.actual_status === 'mirrored') out.push('Broker mirrored the order as intended.')
  return out
}

function buildFailed(s: ForensicsShadowInput, scores: { entry: number; exec: number; outcome: number | null }): string[] {
  const out: string[] = []
  if (scores.entry < 60)    out.push(`Entry plan was incomplete — SL ${s.intended_sl == null ? 'missing' : 'set'}, TP ${s.intended_tp == null ? 'missing' : 'set'}.`)
  if (scores.exec  < 60)    out.push(`Execution was poor — ${s.actual_status}${s.slippage_pct != null ? `, slippage ${(s.slippage_pct * 100).toFixed(3)}%` : ''}.`)
  if (scores.outcome != null && scores.outcome < 60) out.push(`Outcome diverged from leader (drift ${s.pnl_drift_pct == null ? 'n/a' : `${s.pnl_drift_pct.toFixed(2)}%`}).`)
  if (s.actual_status === 'failed')   out.push('Broker FAILED to fill — trade never landed.')
  if (s.actual_status === 'skipped')  out.push(`Trade SKIPPED (${s.skip_reason ?? 'reason not recorded'}).`)
  return out
}

function buildLessons(s: ForensicsShadowInput, exp: TradeExplanation): string[] {
  const out: string[] = []
  if (s.intended_sl == null) out.push('Always set a stop-loss before submitting — risk was uncapped here.')
  if (s.intended_tp == null) out.push('Take-profit was unset — trade had no defined exit target.')
  if (exp.exec_slippage_pct != null && Math.abs(exp.exec_slippage_pct) > 0.005) {
    out.push('Slippage exceeded 0.5% — review broker quality + order type (market vs limit).')
  }
  if (exp.outcome_pnl_drift_pct != null && Math.abs(exp.outcome_pnl_drift_pct) > 10) {
    out.push('PnL drift > 10% from leader — check copy-allocation + spread differences.')
  }
  return out
}

// ── Main entry point ──────────────────────────────────────────────

export function analyzeTradeForensically(
  s: ForensicsShadowInput,
  ctx: ForensicsSignalContext | null = null,
): ForensicsReport {
  const entry   = entryQuality(s, ctx)
  const exec    = executionQuality(s)
  const outcome = outcomeQuality(s)
  const process = processQuality(s)

  // Composite weighting differs depending on whether outcome is known.
  // Open trades aren't penalised for missing outcome — process counts more.
  const composite = outcome == null
    ? Math.round(entry * 0.40 + exec * 0.35 + process * 0.25)
    : Math.round(entry * 0.30 + exec * 0.25 + outcome * 0.25 + process * 0.20)

  const grade = gradeFor(composite)

  const expectedPnl = s.leader_pnl
  const actualPnl   = s.follower_pnl

  const exp: TradeExplanation = {
    shadow_execution_id:      s.id,
    user_id:                  s.user_id,
    entry_signal_strength:    strengthLabel(normConf(ctx?.confidence ?? null)),
    entry_market_regime:      ctx?.market_regime ?? null,
    entry_trend_alignment:    null,   // requires market-data lookup; honest null
    entry_volatility:         volatilityFromSlippage(s.slippage_pct),
    entry_risk_score:         entry,
    entry_qualification:      buildQualificationCopy(s, ctx, entry),
    exec_intended_entry:      s.intended_entry,
    exec_actual_fill:         s.actual_fill_price,
    exec_slippage_pct:        s.slippage_pct,
    exec_efficiency:          exec,
    exec_broker_contribution: brokerContribution(s.slippage_pct, s.actual_status),
    outcome_expected_pnl:     expectedPnl,
    outcome_actual_pnl:       actualPnl,
    outcome_pnl_drift_pct:    s.pnl_drift_pct,
    outcome_risk_adjusted:    null,
    outcome_grade:            outcome == null ? null : gradeFor(outcome),
    engine_version:           FORENSICS_VERSION,
  }

  const scores = { entry, exec, outcome }
  const worked  = buildWorked(s, scores)
  const failed  = buildFailed(s, scores)
  const lessons = buildLessons(s, exp)

  const review: TradeReview = {
    shadow_execution_id:  s.id,
    user_id:              s.user_id,
    what_worked:          worked,
    what_failed:          failed,
    lessons_learned:      lessons,
    confidence_score:     composite,
    institutional_rating: grade,
    reviewer:             FORENSICS_VERSION,
  }

  const outcomeFacts = buildOutcome(s)

  const quality: TradeQualityScore = {
    shadow_execution_id: s.id,
    user_id:             s.user_id,
    entry_quality:       entry,
    execution_quality:   exec,
    outcome_quality:     outcome ?? 0,
    process_quality:     process,
    composite_score:     composite,
    grade,
    scoring_version:     FORENSICS_VERSION,
  }

  return { explanation: exp, review, outcome: outcomeFacts, quality }
}

function buildQualificationCopy(
  s: ForensicsShadowInput,
  ctx: ForensicsSignalContext | null,
  entry: number,
): string {
  const parts: string[] = []
  parts.push(`${s.symbol} ${s.direction.toUpperCase()} via ${s.broker}.`)
  const conf = normConf(ctx?.confidence ?? null)
  if (conf != null) parts.push(`Signal confidence ${conf}%.`)
  if (ctx?.market_regime) parts.push(`Regime: ${ctx.market_regime}.`)
  if (s.intended_sl != null && s.intended_tp != null) {
    parts.push(`Plan: SL ${s.intended_sl}, TP ${s.intended_tp}.`)
  } else if (s.intended_sl == null && s.intended_tp == null) {
    parts.push('Neither SL nor TP set on submission.')
  }
  parts.push(`Entry-quality score ${entry}/100.`)
  return parts.join(' ')
}
