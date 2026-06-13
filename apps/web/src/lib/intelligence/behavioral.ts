/**
 * Behavioral analysis for the Trader Intelligence Dashboard (Refocus R4).
 *
 * Pure functions over `journal_entries` rows — no Supabase, no I/O.
 * The dashboard fetches once, hands the rows here, and renders the
 * verdicts. Every score is a deterministic computation; if the sample
 * size is too thin to be honest, the function returns `null` for that
 * score so the UI can render an "insufficient data" pill instead of a
 * fabricated number.
 *
 * Design notes
 * ------------
 * - Inputs are journal rows, not signals — the user is responsible for
 *   logging their own behavior. Signals are independent of behavior.
 * - "Score" outputs are 0–100 unless documented otherwise. Higher is
 *   generally better discipline; emotional-trading and revenge scores
 *   are HIGHER = WORSE (named with a `_risk` suffix to keep that clear).
 * - Time windows are passed in by the caller (the page picks 30d).
 * - All thresholds are constants near the top so a future calibration
 *   pass can tune them without touching the call sites.
 */
import type { JournalEntry as BaseEntry } from '@/lib/types'

// The DB has columns the shared type doesn't yet enumerate (added by
// later migrations: risk_pct, rule_violation, emotion_pre/post, etc.).
// Extending here keeps R4 self-contained without cascading a wider
// types refactor; the JournalEntry interface in lib/types.ts can be
// widened later.
type JournalEntry = BaseEntry & {
  risk_pct?:       number | null
  rule_violation?: boolean | null
  emotion_pre?:    string | null
  emotion_post?:   string | null
  session?:        string | null
  regime_at_entry?: string | null
  ai_review?:      string | null
  ai_score?:       number | null
  ai_tags?:        string[] | null
  mistakes?:       string | null
}

/** Minimum sample sizes before a score is meaningful. */
const MIN_SAMPLE_OVERALL  = 8
const MIN_SAMPLE_PER_AXIS = 4

/** Revenge detection — a losing trade followed by a higher-risk trade. */
const REVENGE_WINDOW_MIN     = 60          // 60 min after a loss is the "hot window"
const REVENGE_RISK_INFLATION = 1.4         // 40% higher risk_pct than rolling avg

/** Overtrading — too many trades per day vs. baseline. */
const OVERTRADE_DAILY_THRESHOLD = 6        // >6 trades in a day on a single pair → flag
const OVERTRADE_HIGH_VOL_BONUS  = 2        // a high-vol day amplifies the threshold

/** Risk inflation after wins. */
const WIN_STREAK_LEN          = 2
const WIN_STREAK_RISK_INFLATE = 1.3        // 30% > rolling avg

/** Consistency — rolling std-dev of P&L. */
const CONSISTENCY_LOW_SCORE_FLOOR = 30

/** Loss-chasing — N consecutive losses where risk_pct stays at/above
 *  baseline instead of de-risking. */
const LOSS_CHASE_STREAK_LEN = 3

/** Impulse — trades with no setup_tag attribution. The trader took the
 *  trade without naming a strategy, which is the textbook impulse signature. */
const IMPULSE_NO_STRATEGY_TAGS = new Set(['', 'impulse', 'gut', 'random', 'no plan', 'fomo'])

// ── V2 institutional behavioral-intelligence thresholds ──────────────
//
// All thresholds are calibrated for retail trader data (24h–30d
// windows, 8–500 trades). A future calibration pass can tune them
// against a labelled prop-firm dataset without changing call sites.

/** Confidence drift — size inflation after a winning streak.
 *  Distinct from risk_inflation_risk: that one is risk_pct; this one
 *  is lot_size (or risk_pct fallback) AND a selectivity collapse. */
const CONFIDENCE_DRIFT_STREAK_LEN   = 2
const CONFIDENCE_DRIFT_SIZE_INFLATE = 1.25
const CONFIDENCE_DRIFT_LOOKAHEAD    = 3

/** Tilt — emotional aggression after a "large" loss (loss > 2× avg loss).
 *  We look at the next TILT_HOT_HOURS hours for risk inflation, an
 *  abnormal trade burst, OR a negative emotion_pre / mistake tag. */
const TILT_LOSS_MULTIPLIER = 2.0
const TILT_HOT_HOURS       = 24
const TILT_BURST_THRESHOLD = 3       // ≥3 trades inside 4 hours after a big loss

/** Recency bias — overweighting the last outcome on a pair. */
const RECENCY_BIAS_CHASE_HOURS  = 24    // same pair within 24h of a win
const RECENCY_BIAS_AVOID_DAYS   = 7     // pair avoided ≥7 days after a single loss
const RECENCY_BIAS_AVOID_BASELINE = 4   // … but only counts if pair was a normal repeat (≥4 prior trades)

/** Strategy hopping — share of unique setup_tags vs total tagged trades.
 *  Above this ratio = the trader is shopping rather than executing. */
const STRATEGY_HOPPING_UNIQUE_RATIO = 0.45

/** Drawdown resilience — minimum DD depth to score against. Anything
 *  shallower is noise inside a normal equity ladder. */
const RESILIENCE_MIN_DD_DEPTH = 0.04   // 4% peak-to-trough drawdown

/** Patience — median inter-trade gap in minutes that maps to score=100.
 *  Below that, score scales down toward 0. */
const PATIENCE_TARGET_GAP_MIN = 240    // 4h between trades = textbook patient

/** Maturity bands. The Trading Maturity Index lands a trader inside
 *  one of these — used as the headline behavioral verdict. */
export const MATURITY_BANDS = [
  { max: 25,  name: 'Beginner'   as const, blurb: 'Building habits — focus on logging + rule adherence.' },
  { max: 50,  name: 'Developing' as const, blurb: 'Patterns emerging — tighten risk + cut impulse trades.' },
  { max: 70,  name: 'Competent'  as const, blurb: 'Consistent execution — refine selectivity + recovery.' },
  { max: 85,  name: 'Advanced'   as const, blurb: 'Institutional-grade discipline — protect the edge.' },
  { max: 100, name: 'Elite'      as const, blurb: 'Top-decile behavior — coach others; scale capital.' },
] as const
export type MaturityLevel = typeof MATURITY_BANDS[number]['name']


export interface BehavioralReport {
  total_trades:        number
  closed_trades:       number
  // Win/loss counts power per-metric sample sizing in the trust layer
  // (e.g. revenge confidence is bounded by post-loss opportunities, not
  // total trades). See behavioral-trust.buildBehavioralTrust().
  wins_count:          number
  losses_count:        number
  window_days:         number

  /** 0–100 — higher is more disciplined. null when sample too thin. */
  consistency_score:   number | null

  /** 0–100 — HIGHER IS WORSE. Frequency of post-loss aggressive entries. */
  revenge_risk:        number | null
  revenge_count:       number

  /** 0–100 — HIGHER IS WORSE. Days where the user blew past the daily trade cap. */
  overtrade_risk:      number | null
  overtrade_days:      number

  /** 0–100 — HIGHER IS WORSE. Tendency to scale up risk after wins. */
  risk_inflation_risk: number | null
  risk_inflation_count: number

  /** 0–100 — HIGHER IS WORSE. Self-reported rule_violation rate. */
  discipline_risk:     number | null
  rule_violations:     number

  /** 0–100 — HIGHER IS WORSE. Ratio of trades where emotion_pre/notes
   *  flagged FOMO/rush/impulse. Separate from `emotion_summary.fomo`
   *  (which is a raw mix ratio) — this one is the gated score the
   *  Psychology page surfaces. null when sample too thin. */
  fomo_risk:           number | null
  fomo_count:          number

  /** 0–100 — HIGHER IS WORSE. Share of trades opened on weekends
   *  (Saturday/Sunday UTC). A weekend trade ≠ automatic gamble, but
   *  consistent weekend activity is one of the clearest behavioral
   *  red flags in retail accounts. */
  weekend_gamble_risk: number | null
  weekend_gamble_count: number

  /** 0–100 — HIGHER IS WORSE. Share of trades with no strategy
   *  attribution (`setup_tag` blank or flagged as impulse/gut/random).
   *  An unnamed setup is, by definition, an unrepeatable one. */
  impulse_risk:        number | null
  impulse_count:       number

  /** 0–100 — HIGHER IS WORSE. Consecutive losses (3+) where the
   *  trader kept risk_pct at or above baseline instead of de-risking.
   *  This is the "doubling-down into a slump" pattern; distinct from
   *  revenge (post-LOSS aggression within minutes). */
  loss_chase_risk:     number | null
  loss_chase_count:    number

  /** Emotional flagging from journal `emotion_pre` field. */
  emotion_summary: {
    fearful: number   // 0–1 ratio
    greedy:  number
    calm:    number
    fomo:    number
    other:   number
  }

  // ─── V2 institutional behavioral risk metrics ──────────────────────

  /** 0–100 — HIGHER IS WORSE. Size + selectivity drift after winning
   *  streaks (separate from risk_inflation_risk which is risk_pct only). */
  confidence_drift_risk:   number | null
  confidence_drift_count:  number
  confidence_drift_events: ConfidenceDriftEvent[]

  /** 0–100 — HIGHER IS WORSE. Behavioral deterioration in the 24h
   *  window after a "large" loss (loss > 2× avg loss). */
  tilt_risk:   number | null
  tilt_events: TiltEvent[]
  /** 0–100 — POSITIVE inverse of tilt_risk; for radar/composite use. */
  tilt_score:  number | null

  /** 0–100 — HIGHER IS WORSE. Chasing recent winners on a pair OR
   *  avoiding a pair after a single loss against prior history. */
  recency_bias_risk:   number | null
  recency_bias_events: RecencyBiasEvent[]

  /** 0–100 — HIGHER IS WORSE. Frequent setup_tag switching — share of
   *  unique tags / total tagged trades. Reflects strategy non-commitment. */
  strategy_hopping_risk:  number | null
  strategy_switch_count:  number

  // ─── V2 institutional positive scores ─────────────────────────────

  /** 0–100 — HIGHER IS BETTER. Quality of recovery after drawdowns.
   *  Composite of recovery speed (trades to new equity high) and
   *  recovery_efficiency (trades_in_recovery / trades_in_drawdown). */
  resilience_score:    number | null
  recovery_time_days:  number | null
  recovery_efficiency: number | null

  /** 0–100 — HIGHER IS BETTER. Selectivity — inter-trade gap discipline
   *  + low impulse + low overtrade composite. */
  patience_score: number | null

  /** 0–100 — HIGHER IS BETTER. Positive flip of discipline/risk
   *  inflation/loss chase — compliance with the trader's own rules. */
  rule_adherence_score: number | null

  /** 0–100 — HIGHER IS BETTER. Composite of low FOMO, low impulse,
   *  low revenge, low tilt — impulse suppression under stress. */
  self_control_score: number | null

  /** 0–100 — HIGHER IS BETTER. Composite of low risk inflation, low
   *  loss chase, low discipline_risk — risk-rule adherence specifically. */
  risk_discipline_score: number | null

  /** 0–100 — HIGHER IS BETTER. The headline institutional verdict.
   *  Weighted: rule_adherence 25% + self_control 25% + risk_discipline
   *  20% + resilience 15% + patience 10% + consistency 5%. */
  trading_maturity_index: number | null
  maturity_level:         MaturityLevel | null
  maturity_blurb:         string | null

  /** Final 6 normalized 0–100 scores surfaced to the UI as a radar.
   *  Convenience field: rebuilds the V2 positive scores into a fixed
   *  shape so the chart layer can iterate one object. */
  institutional_scores: {
    psychology:   number | null
    discipline:   number | null
    consistency:  number | null
    resilience:   number | null
    patience:     number | null
    maturity:     number | null
  }

  /** Deterministic coaching narrative — strengths, weaknesses,
   *  recommendations, ranked alerts. Free, always-on (no LLM). */
  coaching: CoachingNarrative

  /** Honest emitted issues, ranked. Used by the coach narrative. */
  flags: BehaviorFlag[]
}


// ── V2 event payloads ───────────────────────────────────────────────

export interface ConfidenceDriftEvent {
  at:           string  // ISO timestamp of the post-streak trade
  pair:         string
  streak_len:   number
  size_multiple: number  // size as a multiple of baseline
}

export interface TiltEvent {
  trigger_at:    string  // ISO timestamp of the triggering large loss
  trigger_loss:  number
  followups:     number  // # trades inside the hot window
  burst:         boolean // true if the hot window had a trade burst
  risk_inflated: boolean // true if any follow-up exceeded baseline risk
  emotion_flag:  boolean // true if any follow-up's emotion_pre was negative
}

export interface RecencyBiasEvent {
  pair:   string
  kind:   'chase_winner' | 'avoid_loser'
  detail: string
}

export interface CoachingNarrative {
  summary:        string
  strengths:      string[]
  weaknesses:     string[]
  recommendations: string[]
  alerts:         BehaviorFlag[]
}


export type BehaviorFlag = {
  kind: 'revenge' | 'overtrade' | 'risk_inflation' | 'rule_violation' |
        'fomo' | 'fear_paralysis' | 'consistency' | 'thin_sample' |
        'weekend_gamble' | 'impulse' | 'loss_chase' |
        'confidence_drift' | 'tilt' | 'recency_bias' | 'strategy_hopping' |
        'low_resilience' | 'low_patience'
  severity: 'info' | 'warn' | 'critical'
  label:   string
  detail:  string
}


/** Public entry point. Pass `JournalEntry[]` already scoped to the window. */
export function analyzeBehavior(
  entries: JournalEntry[],
  windowDays = 30,
  /** Current account equity (broker equity_usd). When known, resilience
   *  drawdown is measured against real equity instead of the PnL high-water
   *  mark — prevents a tiny early peak producing absurd depths like 3509%. */
  accountEquity?: number,
): BehavioralReport {
  // Sort newest → oldest so the first scan reads the most recent state.
  // Keep a chronological alias for the streak/revenge passes that need
  // forward-direction order.
  const rows  = [...entries].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  )
  const chron = [...rows].reverse()
  const closed = rows.filter((r) => r.pnl != null)

  const flags: BehaviorFlag[] = []

  const thinSample = closed.length < MIN_SAMPLE_OVERALL
  if (thinSample) {
    flags.push({
      kind: 'thin_sample',
      severity: 'info',
      label: 'Not enough trades yet',
      detail: `Need ${MIN_SAMPLE_OVERALL}+ closed trades to score behavior; have ${closed.length}.`,
    })
  }

  const revenge        = thinSample ? null : detectRevenge(chron, flags)
  const overtrade      = thinSample ? null : detectOvertrade(chron, flags)
  const riskInflation  = thinSample ? null : detectRiskInflation(chron, flags)
  const discipline     = thinSample ? null : detectDisciplineRisk(closed, flags)
  const consistency    = thinSample ? null : computeConsistency(closed, flags)
  const fomo           = thinSample ? null : detectFomo(rows, flags)
  const weekendGamble  = thinSample ? null : detectWeekendGamble(rows, flags)
  const impulse        = thinSample ? null : detectImpulse(rows, flags)
  const lossChase      = thinSample ? null : detectLossChase(chron, flags)
  const emotionSummary = summarizeEmotions(rows)

  // V2 institutional metrics — same thin-sample gate.
  const confidenceDrift = thinSample ? null : detectConfidenceDrift(chron, flags)
  const tilt            = thinSample ? null : detectTilt(chron, flags)
  const recencyBias     = thinSample ? null : detectRecencyBias(chron, flags)
  const strategyHopping = thinSample ? null : detectStrategyHopping(rows, flags)
  const closedPnlTotal  = closed.reduce((s, r) => s + ((r.pnl as number) ?? 0), 0)
  const startingBalance = (accountEquity != null && Number.isFinite(accountEquity) && accountEquity > 0)
    ? Math.max(0, accountEquity - closedPnlTotal)
    : 0
  const resilience      = thinSample ? null : computeResilience(chron, flags, startingBalance)
  const patience        = thinSample ? null : computePatience(chron, impulse?.count ?? 0, overtrade?.days ?? 0, flags)

  const fomoRisk          = fomo?.score ?? null
  const overtradeRisk     = overtrade?.score ?? null
  const revengeRisk       = revenge?.score ?? null
  const riskInflationRisk = riskInflation?.score ?? null
  const disciplineRisk    = discipline?.score ?? null
  const impulseRisk       = impulse?.score ?? null
  const lossChaseRisk     = lossChase?.score ?? null
  const tiltRisk          = tilt?.score ?? null

  // Composite positive scores. Each is null if any constituent is null
  // — institutional reports never average around `null` to fabricate a
  // number; the UI shows "—" when sample is thin.
  const ruleAdherence  = invertComposite([disciplineRisk, riskInflationRisk, lossChaseRisk])
  const selfControl    = invertComposite([fomoRisk, impulseRisk, revengeRisk, tiltRisk])
  const riskDiscipline = invertComposite([riskInflationRisk, lossChaseRisk, disciplineRisk])

  // Maturity index — weighted blend of the institutional scores.
  // Constants documented in MEMORY → psychology-engine-v2-spec.
  const maturityIdx = weightedScore([
    [ruleAdherence,                       0.25],
    [selfControl,                         0.25],
    [riskDiscipline,                      0.20],
    [resilience?.score ?? null,           0.15],
    [patience,                            0.10],
    [consistency,                         0.05],
  ])
  const maturityLevel = maturityIdx != null ? bandMaturity(maturityIdx) : null

  const tiltScore = tiltRisk != null ? clamp01_100(100 - tiltRisk) : null

  const report: BehavioralReport = {
    total_trades:        rows.length,
    closed_trades:       closed.length,
    wins_count:          closed.filter((r) => (r.pnl ?? 0) > 0).length,
    losses_count:        closed.filter((r) => (r.pnl ?? 0) < 0).length,
    window_days:         windowDays,
    consistency_score:   consistency,
    revenge_risk:        revengeRisk,
    revenge_count:       revenge?.count ?? 0,
    overtrade_risk:      overtradeRisk,
    overtrade_days:      overtrade?.days  ?? 0,
    risk_inflation_risk: riskInflationRisk,
    risk_inflation_count: riskInflation?.count ?? 0,
    discipline_risk:     disciplineRisk,
    rule_violations:     discipline?.count ?? 0,
    fomo_risk:           fomoRisk,
    fomo_count:          fomo?.count ?? 0,
    weekend_gamble_risk: weekendGamble?.score ?? null,
    weekend_gamble_count: weekendGamble?.count ?? 0,
    impulse_risk:        impulseRisk,
    impulse_count:       impulse?.count ?? 0,
    loss_chase_risk:     lossChaseRisk,
    loss_chase_count:    lossChase?.count ?? 0,
    emotion_summary:     emotionSummary,

    // V2 fields
    confidence_drift_risk:   confidenceDrift?.score ?? null,
    confidence_drift_count:  confidenceDrift?.count ?? 0,
    confidence_drift_events: confidenceDrift?.events ?? [],

    tilt_risk:   tiltRisk,
    tilt_events: tilt?.events ?? [],
    tilt_score:  tiltScore,

    recency_bias_risk:   recencyBias?.score ?? null,
    recency_bias_events: recencyBias?.events ?? [],

    strategy_hopping_risk: strategyHopping?.score ?? null,
    strategy_switch_count: strategyHopping?.switches ?? 0,

    resilience_score:    resilience?.score ?? null,
    recovery_time_days:  resilience?.recovery_time_days ?? null,
    recovery_efficiency: resilience?.recovery_efficiency ?? null,

    patience_score:        patience,
    rule_adherence_score:  ruleAdherence,
    self_control_score:    selfControl,
    risk_discipline_score: riskDiscipline,

    trading_maturity_index: maturityIdx,
    maturity_level:         maturityLevel?.name ?? null,
    maturity_blurb:         maturityLevel?.blurb ?? null,

    institutional_scores: {
      psychology:  selfControl,
      discipline:  ruleAdherence,
      consistency: consistency,
      resilience:  resilience?.score ?? null,
      patience:    patience,
      maturity:    maturityIdx,
    },

    coaching: { summary: '', strengths: [], weaknesses: [], recommendations: [], alerts: [] },
    flags,
  }

  // Generate the coaching narrative against the finalized report so all
  // V2 scores are available to it.
  report.coaching = generateCoaching(report)

  return report
}


// ─── Revenge detection ──────────────────────────────────────────────

function detectRevenge(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS) return { score: null, count: 0 }

  const avgRisk = mean(closed.map((r) => r.risk_pct ?? null).filter((x): x is number => x != null))
  let revengeCount = 0
  let opportunities = 0

  for (let i = 0; i < closed.length - 1; i++) {
    const curr = closed[i]
    const next = closed[i + 1]
    if (curr == null || next == null) continue
    if ((curr.pnl ?? 0) >= 0) continue   // only count post-loss

    opportunities++
    const minutesAfter =
      (+new Date(next.created_at) - +new Date(curr.created_at)) / 60_000
    if (minutesAfter > REVENGE_WINDOW_MIN) continue
    if (next.risk_pct == null || avgRisk == null) continue

    if (next.risk_pct > avgRisk * REVENGE_RISK_INFLATION) revengeCount++
  }

  if (opportunities < MIN_SAMPLE_PER_AXIS) return { score: null, count: revengeCount }
  const ratio = revengeCount / opportunities
  const score = Math.min(100, Math.round(ratio * 140))   // 70% revenge → ~98
  if (revengeCount >= 2) {
    flags.push({
      kind: 'revenge',
      severity: score >= 60 ? 'critical' : 'warn',
      label: 'Revenge trading detected',
      detail: `${revengeCount} of ${opportunities} post-loss trades took ${Math.round((REVENGE_RISK_INFLATION - 1) * 100)}%+ extra risk within ${REVENGE_WINDOW_MIN} minutes.`,
    })
  }
  return { score, count: revengeCount }
}


// ─── Overtrading detection ──────────────────────────────────────────

function detectOvertrade(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; days: number } {
  const byDay = new Map<string, JournalEntry[]>()
  for (const r of chron) {
    const day = (r.trade_date ?? r.created_at.slice(0, 10))
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(r)
  }

  let flagged = 0
  for (const [, dayRows] of byDay) {
    if (dayRows.length > OVERTRADE_DAILY_THRESHOLD) flagged++
  }

  const ratio = flagged / Math.max(1, byDay.size)
  const score = Math.min(100, Math.round(ratio * 200))
  if (flagged >= 2) {
    flags.push({
      kind: 'overtrade',
      severity: score >= 50 ? 'critical' : 'warn',
      label: 'Overtrading pattern',
      detail: `${flagged} day${flagged === 1 ? '' : 's'} exceeded ${OVERTRADE_DAILY_THRESHOLD} trades. Stick to a daily cap.`,
    })
  }
  return { score, days: flagged }
}


// ─── Risk inflation after winning streaks ───────────────────────────

function detectRiskInflation(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  const closed = chron.filter((r) => r.pnl != null && r.risk_pct != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS + WIN_STREAK_LEN) {
    return { score: null, count: 0 }
  }
  const avgRisk = mean(closed.map((r) => r.risk_pct as number)) ?? 0
  if (avgRisk <= 0) return { score: null, count: 0 }

  let count = 0
  let opportunities = 0
  let streak = 0
  for (let i = 0; i < closed.length; i++) {
    const r = closed[i]
    if (r == null) continue
    if ((r.pnl ?? 0) > 0) {
      streak++
      if (streak >= WIN_STREAK_LEN && i + 1 < closed.length) {
        const after = closed[i + 1]
        if (after && after.risk_pct != null) {
          opportunities++
          if (after.risk_pct > avgRisk * WIN_STREAK_RISK_INFLATE) count++
        }
      }
    } else {
      streak = 0
    }
  }

  if (opportunities < MIN_SAMPLE_PER_AXIS) return { score: null, count }
  const ratio = count / opportunities
  const score = Math.min(100, Math.round(ratio * 130))
  if (count >= 2) {
    flags.push({
      kind: 'risk_inflation',
      severity: score >= 55 ? 'critical' : 'warn',
      label: 'Risk inflation after wins',
      detail: `${count} of ${opportunities} trades after a ${WIN_STREAK_LEN}-win streak used ${Math.round((WIN_STREAK_RISK_INFLATE - 1) * 100)}%+ more risk than your baseline.`,
    })
  }
  return { score, count }
}


// ─── Discipline (rule_violation) ────────────────────────────────────

function detectDisciplineRisk(
  closed: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  const flagged = closed.filter((r) => r.rule_violation === true).length
  // Trust audit: rule_violation is a SELF-REPORTED boolean. If the trader
  // never logs it (field absent on every trade), we have NO evidence of
  // discipline — it must be Insufficient, NOT a perfect 0-risk/100 score.
  // Only trades that explicitly set the flag (true or false) count as logged.
  const logged = closed.filter((r) => typeof r.rule_violation === 'boolean').length
  if (closed.length < MIN_SAMPLE_PER_AXIS || logged === 0) return { score: null, count: flagged }
  const ratio = flagged / logged
  const score = Math.min(100, Math.round(ratio * 200))
  if (flagged >= 2) {
    flags.push({
      kind: 'rule_violation',
      severity: score >= 40 ? 'critical' : 'warn',
      label: 'Rule violations stacking up',
      detail: `${flagged} of ${closed.length} closed trades were marked as rule-violations.`,
    })
  }
  return { score, count: flagged }
}


// ─── Consistency (P&L std-dev penalty) ──────────────────────────────

function computeConsistency(closed: JournalEntry[], flags: BehaviorFlag[]): number | null {
  const pnls = closed.map((r) => r.pnl as number).filter((x) => Number.isFinite(x))
  if (pnls.length < MIN_SAMPLE_OVERALL) return null
  const m = mean(pnls) ?? 0
  const variance = pnls.reduce((a, v) => a + (v - m) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  const meanAbs = Math.max(1, Math.abs(m))
  // Coefficient of variation; capped. Low CV (steady curve) = high consistency.
  const cv  = std / meanAbs
  const raw = Math.max(0, 100 - cv * 25)
  const score = Math.round(raw)
  if (score < CONSISTENCY_LOW_SCORE_FLOOR) {
    flags.push({
      kind: 'consistency',
      severity: 'warn',
      label: 'Inconsistent P&L distribution',
      detail: `Wide swing-to-swing variance — coefficient of variation ${cv.toFixed(2)}.`,
    })
  }
  return score
}


// ─── FOMO score ──────────────────────────────────────────────────────
//
// Distinct from emotion_summary.fomo (a raw ratio). This is the gated,
// flag-emitting score the Psychology page surfaces. Pulls from
// emotion_pre, ai_tags, and a notes-keyword scan.

function detectFomo(
  rows: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  let count = 0
  let logged = 0
  for (const r of rows) {
    if (rowHasEmotionEvidence(r)) logged++
    if (rowSignalsFomo(r)) count++
  }
  // Trust audit (C1): FOMO is inferred from SELF-REPORTED emotion_pre / notes /
  // ai_tags. If the trader never logs any of those, absence of a FOMO signal is
  // NOT evidence of emotional control — it's unknown. Insufficient, not 0-risk.
  if (rows.length < MIN_SAMPLE_PER_AXIS || logged < MIN_SAMPLE_PER_AXIS) return { score: null, count }
  const ratio = count / logged
  const score = Math.min(100, Math.round(ratio * 180))
  if (count >= 2) {
    flags.push({
      kind: 'fomo',
      severity: score >= 50 ? 'critical' : 'warn',
      label: 'FOMO entries detected',
      detail: `${count} of ${rows.length} trades flagged as FOMO-driven (emotion, notes, or AI tag). Chase entries collapse expectancy.`,
    })
  }
  return { score, count }
}

/** Did the trader log ANY emotional signal on this trade? FOMO can only be
 *  measured where this is true — absence is "unknown", never "no FOMO". */
function rowHasEmotionEvidence(r: JournalEntry): boolean {
  return Boolean((r.emotion_pre ?? '').trim())
    || (r.ai_tags ?? []).length > 0
    || Boolean((r.notes ?? '').trim())
}

function rowSignalsFomo(r: JournalEntry): boolean {
  const emo = (r.emotion_pre ?? '').toLowerCase()
  if (emo.includes('fomo') || emo.includes('rush') || emo.includes('impuls')) return true
  const tags = (r.ai_tags ?? []).map((t) => t.toLowerCase())
  if (tags.some((t) => t.includes('fomo') || t.includes('chase'))) return true
  const notes = (r.notes ?? '').toLowerCase()
  if (notes.includes('fomo') || notes.includes('chase') || notes.includes("couldn't wait")) return true
  return false
}


// ─── Weekend gambling ────────────────────────────────────────────────
//
// Trades opened Saturday/Sunday UTC. Forex doesn't trade weekends, but
// crypto does — so a sustained weekend cadence on a retail account often
// indicates the trader is sitting at a screen when they should not be.

function detectWeekendGamble(
  rows: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  let count = 0
  for (const r of rows) {
    const d = new Date(r.created_at).getUTCDay()  // 0=Sun, 6=Sat
    if (d === 0 || d === 6) count++
  }
  if (rows.length < MIN_SAMPLE_PER_AXIS) return { score: null, count }
  const ratio = count / rows.length
  const score = Math.min(100, Math.round(ratio * 220))
  if (count >= 2) {
    flags.push({
      kind: 'weekend_gamble',
      severity: score >= 40 ? 'critical' : 'warn',
      label: 'Weekend trading pattern',
      detail: `${count} of ${rows.length} trades opened on Sat/Sun (UTC). Sustained weekend activity is a fatigue / boredom flag.`,
    })
  }
  return { score, count }
}


// ─── Impulse — no strategy attribution ──────────────────────────────
//
// `setup_tag` is the trader's named strategy/edge. A blank tag, or one
// explicitly marked impulse/gut/random/no-plan, is — by the trader's
// own admission — an unrepeatable entry. We count those.

function detectImpulse(
  rows: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  let count = 0
  for (const r of rows) {
    const tag = (r.setup_tag ?? '').trim().toLowerCase()
    if (IMPULSE_NO_STRATEGY_TAGS.has(tag)) count++
  }
  if (rows.length < MIN_SAMPLE_PER_AXIS) return { score: null, count }
  const ratio = count / rows.length
  const score = Math.min(100, Math.round(ratio * 160))
  if (count >= 2) {
    flags.push({
      kind: 'impulse',
      severity: score >= 50 ? 'critical' : 'warn',
      label: 'Impulse trades (no strategy)',
      detail: `${count} of ${rows.length} trades have no setup_tag — by your own log, you can't reproduce that edge.`,
    })
  }
  return { score, count }
}


// ─── Loss chasing — N consecutive losses without de-risking ─────────
//
// Differs from revenge (single post-loss aggression within 60min): this
// catches the slow-bleed pattern where a trader stays at full risk
// through a 3+ loss streak instead of pulling size down.

function detectLossChase(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number } {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS + LOSS_CHASE_STREAK_LEN) {
    return { score: null, count: 0 }
  }
  const avgRisk = mean(
    closed.map((r) => r.risk_pct ?? null).filter((x): x is number => x != null),
  )
  if (avgRisk == null || avgRisk <= 0) return { score: null, count: 0 }

  let count = 0
  let lossStreak = 0
  for (let i = 0; i < closed.length; i++) {
    const r = closed[i]
    if (r == null) continue
    if ((r.pnl ?? 0) < 0) {
      lossStreak++
      if (lossStreak >= LOSS_CHASE_STREAK_LEN && r.risk_pct != null) {
        if (r.risk_pct >= avgRisk) count++
      }
    } else {
      lossStreak = 0
    }
  }
  const score = Math.min(100, Math.round((count / Math.max(1, closed.length)) * 220))
  if (count >= 2) {
    flags.push({
      kind: 'loss_chase',
      severity: score >= 35 ? 'critical' : 'warn',
      label: 'Loss-chasing pattern',
      detail: `${count} trade${count === 1 ? '' : 's'} during a ${LOSS_CHASE_STREAK_LEN}+ loss streak kept risk at/above baseline. De-risk during slumps.`,
    })
  }
  return { score, count }
}


// ─── Emotion mix ─────────────────────────────────────────────────────

function summarizeEmotions(rows: JournalEntry[]) {
  type EmoRow = JournalEntry & { emotion_pre?: string | null }
  const pre = rows
    .map((r) => (r as EmoRow).emotion_pre)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  const total = pre.length || 1
  const counts = { fearful: 0, greedy: 0, calm: 0, fomo: 0, other: 0 }
  for (const e of pre) {
    const t = e.toLowerCase()
    if (t.includes('fear') || t.includes('anx')) counts.fearful++
    else if (t.includes('greed')) counts.greedy++
    else if (t.includes('calm') || t.includes('focus') || t.includes('neutral')) counts.calm++
    else if (t.includes('fomo') || t.includes('rush') || t.includes('impuls')) counts.fomo++
    else counts.other++
  }
  return {
    fearful: counts.fearful / total,
    greedy:  counts.greedy  / total,
    calm:    counts.calm    / total,
    fomo:    counts.fomo    / total,
    other:   counts.other   / total,
  }
}


// ─── V2 — Confidence Drift ──────────────────────────────────────────
//
// Drift = lot-size inflation + reduced selectivity after a winning
// streak. Separate signal from risk_inflation_risk (which only watches
// risk_pct). When lot_size is missing we fall back to risk_pct so the
// score still computes — never silently zero-out.

function detectConfidenceDrift(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; count: number; events: ConfidenceDriftEvent[] } {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS + CONFIDENCE_DRIFT_STREAK_LEN) {
    return { score: null, count: 0, events: [] }
  }
  const sizes = closed.map((r) =>
    (typeof r.lot_size === 'number' && r.lot_size > 0)
      ? r.lot_size
      : (typeof r.risk_pct === 'number' && r.risk_pct > 0 ? r.risk_pct : null),
  )
  const sizeAvg = mean(sizes.filter((x): x is number => x != null))
  if (sizeAvg == null || sizeAvg <= 0) return { score: null, count: 0, events: [] }

  let count = 0
  let opportunities = 0
  let streak = 0
  const events: ConfidenceDriftEvent[] = []

  for (let i = 0; i < closed.length; i++) {
    const r = closed[i]
    if (r == null) continue
    if ((r.pnl ?? 0) > 0) {
      streak++
      if (streak >= CONFIDENCE_DRIFT_STREAK_LEN) {
        // Examine up to LOOKAHEAD next trades for size inflation.
        for (let j = 1; j <= CONFIDENCE_DRIFT_LOOKAHEAD; j++) {
          const after = closed[i + j]
          if (after == null) break
          const sz = (typeof after.lot_size === 'number' && after.lot_size > 0)
            ? after.lot_size
            : (typeof after.risk_pct === 'number' ? after.risk_pct : null)
          if (sz == null) continue
          opportunities++
          if (sz > sizeAvg * CONFIDENCE_DRIFT_SIZE_INFLATE) {
            count++
            events.push({
              at:           after.created_at,
              pair:         after.pair ?? '—',
              streak_len:   streak,
              size_multiple: Number((sz / sizeAvg).toFixed(2)),
            })
          }
        }
      }
    } else {
      streak = 0
    }
  }

  if (opportunities < MIN_SAMPLE_PER_AXIS) return { score: null, count, events }
  const score = Math.min(100, Math.round((count / opportunities) * 140))
  if (count >= 2) {
    flags.push({
      kind: 'confidence_drift',
      severity: score >= 55 ? 'critical' : 'warn',
      label: 'Confidence drift after wins',
      detail: `${count} of ${opportunities} post-streak entries used ${Math.round((CONFIDENCE_DRIFT_SIZE_INFLATE - 1) * 100)}%+ size vs your baseline. Strong runs invite over-sizing.`,
    })
  }
  return { score, count, events }
}


// ─── V2 — Tilt detection ────────────────────────────────────────────
//
// Tilt = the 24h after a "large" loss (loss > 2× avg loss). We flag
// the window if any of: (a) risk_pct exceeds baseline, (b) ≥3 trades
// inside 4h burst, (c) emotion_pre / mistakes flag negative.

function detectTilt(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; events: TiltEvent[] } {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS) return { score: null, events: [] }

  const losses = closed.map((r) => r.pnl as number).filter((p) => p < 0)
  if (losses.length === 0) return { score: null, events: [] }
  const avgLoss = Math.abs(mean(losses) ?? 0)
  const tiltThreshold = -avgLoss * TILT_LOSS_MULTIPLIER

  const avgRisk = mean(
    closed.map((r) => r.risk_pct ?? null).filter((x): x is number => x != null),
  ) ?? null

  const events: TiltEvent[] = []
  for (let i = 0; i < closed.length; i++) {
    const r = closed[i]
    if (r == null) continue
    if ((r.pnl ?? 0) > tiltThreshold) continue   // not a "large" loss

    const triggerTime = +new Date(r.created_at)
    const followups: JournalEntry[] = []
    for (let j = i + 1; j < closed.length; j++) {
      const next = closed[j]
      if (next == null) continue
      const dt = (+new Date(next.created_at) - triggerTime) / 3_600_000
      if (dt > TILT_HOT_HOURS) break
      followups.push(next)
    }
    if (followups.length === 0) continue

    // Burst: ≥3 trades inside any 4h slice of the window.
    let burst = false
    for (let k = 0; k <= followups.length - TILT_BURST_THRESHOLD; k++) {
      const first = followups[k]
      const last  = followups[k + TILT_BURST_THRESHOLD - 1]
      if (first == null || last == null) continue
      const span = (+new Date(last.created_at) - +new Date(first.created_at)) / 3_600_000
      if (span <= 4) { burst = true; break }
    }
    const riskInflated = avgRisk != null && followups.some(
      (f) => f.risk_pct != null && f.risk_pct > avgRisk * 1.2,
    )
    const emotionFlag = followups.some((f) => {
      const e = (f.emotion_pre ?? '').toLowerCase()
      const m = (f.mistakes ?? '').toLowerCase()
      return e.includes('angry') || e.includes('frustrat') || e.includes('tilt') ||
             e.includes('revenge') || m.includes('tilt') || m.includes('revenge')
    })

    if (burst || riskInflated || emotionFlag) {
      events.push({
        trigger_at:    r.created_at,
        trigger_loss:  r.pnl as number,
        followups:     followups.length,
        burst,
        risk_inflated: riskInflated,
        emotion_flag:  emotionFlag,
      })
    }
  }

  if (events.length === 0) return { score: 0, events: [] }
  // Score scales with event count vs total trades, soft-capped.
  const score = Math.min(100, Math.round((events.length / Math.max(1, closed.length)) * 320))
  flags.push({
    kind: 'tilt',
    severity: score >= 50 ? 'critical' : 'warn',
    label: 'Tilt after large losses',
    detail: `${events.length} large-loss window${events.length === 1 ? '' : 's'} showed bursts, risk inflation, or negative emotion logs. De-risk for 24h after any ${Math.round(TILT_LOSS_MULTIPLIER)}×-avg loss.`,
  })
  return { score, events }
}


// ─── V2 — Recency bias ──────────────────────────────────────────────
//
// Per-pair: chasing a recent winner (same pair within 24h of a win,
// with bigger size) OR avoiding a recent loser (pair has ≥4 prior
// trades but goes silent ≥7 days after a single loss).

function detectRecencyBias(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; events: RecencyBiasEvent[] } {
  const closed = chron.filter((r) => r.pnl != null && r.pair)
  if (closed.length < MIN_SAMPLE_PER_AXIS) return { score: null, events: [] }

  // Group by pair.
  const byPair = new Map<string, JournalEntry[]>()
  for (const r of closed) {
    const k = r.pair as string
    if (!byPair.has(k)) byPair.set(k, [])
    byPair.get(k)!.push(r)
  }

  // Baseline size per trader to compare chase entries against.
  const sizes = closed.map((r) =>
    typeof r.lot_size === 'number' ? r.lot_size
      : typeof r.risk_pct === 'number' ? r.risk_pct : null,
  ).filter((x): x is number => x != null)
  const sizeAvg = mean(sizes) ?? 0

  const events: RecencyBiasEvent[] = []
  // closed is chron-asc, so newest is the LAST element.
  const lastTradeAt = +new Date(closed[closed.length - 1]?.created_at ?? Date.now())

  for (const [pair, rows] of byPair) {
    // Chase: any (win → next-same-pair within 24h with size > baseline).
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i]; const b = rows[i + 1]
      if (a == null || b == null) continue
      if ((a.pnl ?? 0) <= 0) continue
      const dtH = (+new Date(b.created_at) - +new Date(a.created_at)) / 3_600_000
      if (dtH > RECENCY_BIAS_CHASE_HOURS) continue
      const bSize = typeof b.lot_size === 'number' ? b.lot_size
        : typeof b.risk_pct === 'number' ? b.risk_pct : null
      if (bSize != null && sizeAvg > 0 && bSize > sizeAvg * 1.15) {
        events.push({
          pair,
          kind: 'chase_winner',
          detail: `Re-entered ${pair} ${Math.round(dtH)}h after a win at ${(bSize / sizeAvg).toFixed(1)}× baseline size.`,
        })
      }
    }
    // Avoid: pair has ≥ AVOID_BASELINE prior trades, last trade was a
    // loss, and pair hasn't been re-traded in ≥ AVOID_DAYS.
    if (rows.length >= RECENCY_BIAS_AVOID_BASELINE) {
      const lastInPair = rows[rows.length - 1]!
      if ((lastInPair.pnl ?? 0) < 0) {
        const sinceDays = (lastTradeAt - +new Date(lastInPair.created_at)) / 86_400_000
        if (sinceDays >= RECENCY_BIAS_AVOID_DAYS) {
          events.push({
            pair,
            kind: 'avoid_loser',
            detail: `Stopped trading ${pair} ${Math.round(sinceDays)}d after a single loss — sample of ${rows.length} prior.`,
          })
        }
      }
    }
  }

  if (events.length === 0) return { score: 0, events: [] }
  const score = Math.min(100, Math.round((events.length / Math.max(1, byPair.size)) * 90))
  if (events.length >= 2) {
    flags.push({
      kind: 'recency_bias',
      severity: score >= 50 ? 'critical' : 'warn',
      label: 'Recency bias on pair selection',
      detail: `${events.length} pair-level pattern${events.length === 1 ? '' : 's'} — chasing recent winners or avoiding recent losers. Both signal selection bias.`,
    })
  }
  return { score, events }
}


// ─── V2 — Strategy hopping ──────────────────────────────────────────
//
// High unique-setup-tag ratio = the trader is shopping setups rather
// than committing to a tested process. Also counts setup switches
// (current trade's setup_tag ≠ previous's) for nuance.

function detectStrategyHopping(
  rows: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number | null; switches: number } {
  const tagged = rows.filter((r) => typeof r.setup_tag === 'string' && r.setup_tag.trim().length > 0)
  if (tagged.length < MIN_SAMPLE_PER_AXIS) return { score: null, switches: 0 }

  const tags = tagged.map((r) => (r.setup_tag as string).trim().toLowerCase())
  const unique = new Set(tags).size
  const uniqueRatio = unique / tagged.length

  // Switches walking chronologically.
  const chron = [...tagged].reverse()
  let switches = 0
  for (let i = 1; i < chron.length; i++) {
    const prev = chron[i - 1]; const curr = chron[i]
    if (prev == null || curr == null) continue
    if ((prev.setup_tag ?? '').trim().toLowerCase() !== (curr.setup_tag ?? '').trim().toLowerCase()) {
      switches++
    }
  }

  // Combined: high unique-ratio + high switch rate both penalize.
  const uniquePenalty = Math.max(0, (uniqueRatio - STRATEGY_HOPPING_UNIQUE_RATIO) / (1 - STRATEGY_HOPPING_UNIQUE_RATIO))
  const switchRate    = switches / Math.max(1, tagged.length - 1)
  const score = Math.min(100, Math.round((uniquePenalty * 60) + (switchRate * 60)))
  if (score >= 40) {
    flags.push({
      kind: 'strategy_hopping',
      severity: score >= 65 ? 'critical' : 'warn',
      label: 'Strategy hopping',
      detail: `${unique} distinct setups across ${tagged.length} trades (${Math.round(uniqueRatio * 100)}% unique). Edge requires repetition.`,
    })
  }
  return { score, switches }
}


// ─── V2 — Drawdown resilience ───────────────────────────────────────
//
// Build the equity curve chronologically. Identify the deepest
// peak-to-trough drawdown ≥ RESILIENCE_MIN_DD_DEPTH. Measure how many
// trades it took to recover to the prior peak, and the efficiency
// ratio of recovery vs drawdown duration.

function computeResilience(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
  startingBalance = 0,
): { score: number; recovery_time_days: number | null; recovery_efficiency: number | null } | null {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_OVERALL) return null

  // Seed the curve at the account's starting balance so peak-to-trough depth
  // is a fraction of real equity, not of a near-zero early PnL peak.
  let equity = startingBalance
  let peak = startingBalance
  const points: { eq: number; at: number; idx: number }[] = []
  for (let i = 0; i < closed.length; i++) {
    const r = closed[i]
    if (r == null) continue
    equity += r.pnl as number
    if (equity > peak) peak = equity
    points.push({ eq: equity, at: +new Date(r.created_at), idx: i })
  }
  if (points.length < MIN_SAMPLE_OVERALL) return null

  // Find deepest DD: scan for peak, then trough, then recovery point.
  let bestDD = { depth: 0, peakIdx: 0, troughIdx: 0, recoveryIdx: -1 }
  let runningPeak = points[0]!.eq
  let runningPeakIdx = 0
  for (let i = 1; i < points.length; i++) {
    const pt = points[i]!
    if (pt.eq > runningPeak) {
      runningPeak = pt.eq
      runningPeakIdx = i
      continue
    }
    const depth = runningPeak - pt.eq
    const normDepth = Math.min(1, depth / Math.max(1, Math.abs(runningPeak)))
    if (normDepth > bestDD.depth) {
      // Find recovery point — first j>i with eq >= runningPeak.
      let recovery = -1
      for (let j = i + 1; j < points.length; j++) {
        if (points[j]!.eq >= runningPeak) { recovery = j; break }
      }
      bestDD = { depth: normDepth, peakIdx: runningPeakIdx, troughIdx: i, recoveryIdx: recovery }
    }
  }

  if (bestDD.depth < RESILIENCE_MIN_DD_DEPTH) {
    // No meaningful drawdown — trader hasn't been stress-tested.
    // Award a neutral 70 (positive but not perfect; absence of stress
    // doesn't equal proven resilience).
    return null   // not stress-tested yet → Insufficient, not a neutral 70
  }

  // Drawdown duration & recovery duration in trades.
  const ddDurationTrades = bestDD.troughIdx - bestDD.peakIdx
  const recovered = bestDD.recoveryIdx > 0
  const recoveryDurationTrades = recovered
    ? bestDD.recoveryIdx - bestDD.troughIdx
    : closed.length - bestDD.troughIdx

  const peakPt     = points[bestDD.peakIdx]!
  const recoveryPt = recovered ? points[bestDD.recoveryIdx]! : null
  const recoveryDays = recoveryPt
    ? (recoveryPt.at - peakPt.at) / 86_400_000
    : null

  // Efficiency: how fast did they recover vs how fast did they fall?
  // ≥1.0 = recovered as fast or faster than they fell (great).
  // <1.0 = recovery took longer than the fall (typical).
  const efficiency = recovered && ddDurationTrades > 0
    ? ddDurationTrades / Math.max(1, recoveryDurationTrades)
    : (recovered ? 1 : 0)

  // Score: full recovery + efficiency floor of 50; bonus for fast.
  let score: number
  if (!recovered) {
    score = Math.max(5, 40 - Math.round(bestDD.depth * 100))   // worse the deeper
  } else {
    const base = 50
    const bonus = Math.min(50, Math.round(efficiency * 50))
    const depthPenalty = Math.min(20, Math.round(bestDD.depth * 100))
    score = clamp01_100(base + bonus - depthPenalty)
  }

  if (score < 35) {
    flags.push({
      kind: 'low_resilience',
      severity: score < 20 ? 'critical' : 'warn',
      label: 'Slow drawdown recovery',
      detail: recovered
        ? `Deepest DD ${Math.round(bestDD.depth * 100)}% took ${recoveryDurationTrades} trades to recover vs ${ddDurationTrades} to fall.`
        : `Deepest DD ${Math.round(bestDD.depth * 100)}% not yet recovered.`,
    })
  }

  return {
    score,
    recovery_time_days:  recoveryDays != null ? Number(recoveryDays.toFixed(1)) : null,
    recovery_efficiency: Number(efficiency.toFixed(2)),
  }
}


// ─── V2 — Patience ──────────────────────────────────────────────────
//
// Selectivity composite: median inter-trade gap (longer = more patient)
// minus penalties for impulse + overtrading.

function computePatience(
  chron: JournalEntry[],
  impulseCount: number,
  overtradeDays: number,
  flags: BehaviorFlag[],
): number | null {
  if (chron.length < MIN_SAMPLE_OVERALL) return null

  const gaps: number[] = []
  for (let i = 1; i < chron.length; i++) {
    const prev = chron[i - 1]; const curr = chron[i]
    if (prev == null || curr == null) continue
    const dt = (+new Date(curr.created_at) - +new Date(prev.created_at)) / 60_000
    if (dt >= 0) gaps.push(dt)
  }
  if (gaps.length < MIN_SAMPLE_PER_AXIS) return null
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0

  // Gap component: median gap → 0–100, target = PATIENCE_TARGET_GAP_MIN.
  const gapComponent = Math.min(100, Math.round((median / PATIENCE_TARGET_GAP_MIN) * 100))
  // Penalties: impulse ratio + overtrade days.
  const impulsePenalty = Math.min(30, Math.round((impulseCount / Math.max(1, chron.length)) * 100))
  const overtradePenalty = Math.min(20, overtradeDays * 4)

  const score = clamp01_100(gapComponent - impulsePenalty - overtradePenalty)
  if (score < 30) {
    flags.push({
      kind: 'low_patience',
      severity: score < 15 ? 'critical' : 'warn',
      label: 'Low patience',
      detail: `Median inter-trade gap ${Math.round(median)} min — well under the ${PATIENCE_TARGET_GAP_MIN} min selectivity baseline.`,
    })
  }
  return score
}


// ─── V2 — Composite scoring helpers ─────────────────────────────────

/** Inverse composite: given N "risk" scores (higher=worse), returns
 *  the 0–100 positive score (100 - mean of risks). Null if ANY input
 *  is null — we never fabricate by averaging around missing data. */
export function invertComposite(risks: (number | null)[]): number | null {
  // Trust audit: insufficient sub-metrics arrive as null and must NOT be
  // treated as 0-risk (that inflated composites to ~100 = "perfect"). Average
  // over MEASURED risks only, and refuse to score without a measured majority.
  const xs = risks.filter((r): r is number => r != null)
  if (xs.length < Math.ceil(risks.length / 2)) return null
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length
  return clamp01_100(100 - avg)
}

/** Weighted composite: pairs of [value, weight]. Weights are
 *  renormalized over the non-null subset so missing axes don't pull
 *  the score to zero (institutional-report convention). Returns null
 *  only if every constituent is null. */
function weightedScore(pairs: [number | null, number][]): number | null {
  let sum = 0; let w = 0
  for (const [v, weight] of pairs) {
    if (v == null) continue
    sum += v * weight
    w   += weight
  }
  if (w === 0) return null
  return clamp01_100(Math.round(sum / w))
}

function bandMaturity(score: number): typeof MATURITY_BANDS[number] {
  for (const band of MATURITY_BANDS) {
    if (score <= band.max) return band
  }
  return MATURITY_BANDS[MATURITY_BANDS.length - 1]!
}

function clamp01_100(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 100) return 100
  return Math.round(x)
}


// ─── V2 — AI coaching narrative ────────────────────────────────────
//
// Deterministic, always-on, free. Walks the V2 scores to produce a
// 1-sentence summary, ranked strengths/weaknesses lists, top-3
// recommendations, and a severity-sorted alerts feed. The Gemini
// deep-dive layer on /psychology is independent of this — that's the
// premium long-form layer; this is the institutional baseline.

export function generateCoaching(b: BehavioralReport): CoachingNarrative {
  const POSITIVE: Array<[string, number | null, string]> = [
    ['Rule adherence',  b.rule_adherence_score,  'rule-following discipline'],
    ['Self-control',    b.self_control_score,    'impulse suppression under stress'],
    ['Risk discipline', b.risk_discipline_score, 'risk-sizing consistency'],
    ['Resilience',      b.resilience_score,      'recovery after drawdowns'],
    ['Patience',        b.patience_score,        'selectivity between trades'],
    ['Consistency',     b.consistency_score,     'steady P&L distribution'],
  ]
  const RISKS: Array<[string, number | null, BehaviorFlag['kind']]> = [
    ['FOMO entries',         b.fomo_risk,           'fomo'],
    ['Impulse trades',       b.impulse_risk,        'impulse'],
    ['Revenge trading',      b.revenge_risk,        'revenge'],
    ['Tilt after losses',    b.tilt_risk,           'tilt'],
    ['Overtrading',          b.overtrade_risk,      'overtrade'],
    ['Risk inflation',       b.risk_inflation_risk, 'risk_inflation'],
    ['Loss chasing',         b.loss_chase_risk,     'loss_chase'],
    ['Confidence drift',     b.confidence_drift_risk,'confidence_drift'],
    ['Strategy hopping',     b.strategy_hopping_risk,'strategy_hopping'],
    ['Recency bias',         b.recency_bias_risk,   'recency_bias'],
    ['Weekend gambling',     b.weekend_gamble_risk, 'weekend_gamble'],
    ['Rule violations',      b.discipline_risk,     'rule_violation'],
  ]

  const strengths = POSITIVE
    .filter(([, v]) => v != null && v >= 70)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 3)
    .map(([label, v, lens]) => `${label} ${v}/100 — strong ${lens}.`)

  const weaknesses = RISKS
    .filter(([, v]) => v != null && v >= 45)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 3)
    .map(([label, v]) => `${label} at ${v}/100 risk — review the flag detail.`)

  // Recommendation library — keyed by the worst-axis kind. Templated,
  // not LLM-generated: deterministic, free, and reviewable.
  const RECOMMENDATIONS: Record<BehaviorFlag['kind'], string> = {
    fomo:             'Add a 5-minute "cool-off" gate before any entry that wasn\'t on your watchlist before market open.',
    impulse:          'No entry without a named setup_tag. If you can\'t name the strategy, you can\'t repeat the edge.',
    revenge:          'Hard-stop after any loss for 60 minutes. Set a phone timer; don\'t override it.',
    tilt:             'After any loss > 2× your average, halve risk for the next 24h and skip the next session if possible.',
    overtrade:        'Cap daily trades at 4. If you\'re past your cap, the next trade closes the screen.',
    risk_inflation:   'Lock max risk_pct in your platform — don\'t allow yourself to raise it mid-session.',
    loss_chase:       'Risk-cut rule: every loss in a streak halves the next position\'s size until a green trade resets it.',
    confidence_drift: 'After 3 wins, freeze size at baseline for the next 24h. Strong runs are when bad sizing creeps in.',
    strategy_hopping: 'Pick 2 setups for the next 30 days. Anything else logs but does not execute.',
    recency_bias:     'Use a static watchlist for the week — pair selection should not bend to yesterday\'s outcome.',
    weekend_gamble:   'Set a hard rule: no trades Sat/Sun unless they\'re scheduled in your weekly plan.',
    rule_violation:   'Run a 7-day rule-violation streak. Any violation resets the counter. Track it daily.',
    consistency:      'Variance is the enemy of compounding. Tighten the worst-quartile trades — start by cutting your largest 10% of risk.',
    fear_paralysis:   'Pre-define entry triggers in writing before market open. Pull the trigger when conditions match — no second guessing.',
    thin_sample:      'Log every trade for the next 2 weeks. Behavior scoring needs 8+ closed trades to be honest.',
    low_resilience:   'After a drawdown, run a "rebuilding mode" — minimum 50% size cut until you reclaim the prior equity high.',
    low_patience:     'No more than 2 trades per session. If neither hits, the session is over — even if you\'re bored.',
  }

  const topWeakKinds = RISKS
    .filter(([, v]) => v != null && v >= 45)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 3)
    .map(([, , kind]) => kind)
  const recommendations = topWeakKinds
    .map((k) => RECOMMENDATIONS[k])
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
  // If no risks crossed the threshold, prescribe the maturity-band blurb
  // as the recommendation so the user always gets a direction.
  if (recommendations.length === 0 && b.maturity_blurb) {
    recommendations.push(b.maturity_blurb)
  }

  // Summary line — leads with maturity verdict + headline strength /
  // weakness so the page opens with signal, not noise.
  const summary = composeSummary(b, strengths.length, weaknesses.length)

  const alerts = [...b.flags]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 6)

  return { summary, strengths, weaknesses, recommendations, alerts }
}

function composeSummary(b: BehavioralReport, strengthsN: number, weaknessesN: number): string {
  if (b.closed_trades < MIN_SAMPLE_OVERALL) {
    return `Behavior scoring needs ${MIN_SAMPLE_OVERALL}+ closed trades — currently ${b.closed_trades}. Log a few more for an honest read.`
  }
  const level = b.maturity_level ?? 'Developing'
  const idx   = b.trading_maturity_index ?? 0
  const headPos =
    (b.rule_adherence_score   ?? 0) >= 70 ? 'rule discipline' :
    (b.self_control_score     ?? 0) >= 70 ? 'self-control'    :
    (b.risk_discipline_score  ?? 0) >= 70 ? 'risk discipline' :
    (b.resilience_score       ?? 0) >= 70 ? 'recovery'        :
    (b.patience_score         ?? 0) >= 70 ? 'patience'        : null
  const headNeg =
    (b.fomo_risk    ?? 0) >= 55 ? 'FOMO entries'      :
    (b.impulse_risk ?? 0) >= 55 ? 'impulse entries'   :
    (b.revenge_risk ?? 0) >= 55 ? 'revenge trading'   :
    (b.tilt_risk    ?? 0) >= 55 ? 'tilt after losses' :
    (b.loss_chase_risk ?? 0) >= 55 ? 'loss chasing'   : null

  if (headPos && headNeg) {
    return `${level} (${idx}/100) — strong ${headPos}, but ${headNeg} is dragging the score.`
  }
  if (headPos) {
    return `${level} (${idx}/100) — ${headPos} is your edge. Protect it while you scale.`
  }
  if (headNeg) {
    return `${level} (${idx}/100) — ${headNeg} is the top blocker; the recommendation below targets it directly.`
  }
  if (strengthsN > 0) {
    return `${level} (${idx}/100) — balanced execution profile across ${strengthsN} scored axes.`
  }
  if (weaknessesN > 0) {
    return `${level} (${idx}/100) — ${weaknessesN} behavioral risk${weaknessesN === 1 ? '' : 's'} flagged. Address the top one first.`
  }
  return `${level} (${idx}/100) — no flagged behaviors in this window. Keep logging.`
}

function severityRank(s: BehaviorFlag['severity']): number {
  return s === 'critical' ? 3 : s === 'warn' ? 2 : 1
}


// ─── Tiny helpers ────────────────────────────────────────────────────

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
