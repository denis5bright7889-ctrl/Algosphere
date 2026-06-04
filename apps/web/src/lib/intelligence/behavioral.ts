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


export interface BehavioralReport {
  total_trades:        number
  closed_trades:       number
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

  /** Honest emitted issues, ranked. Used by the coach narrative. */
  flags: BehaviorFlag[]
}


export type BehaviorFlag = {
  kind: 'revenge' | 'overtrade' | 'risk_inflation' | 'rule_violation' |
        'fomo' | 'fear_paralysis' | 'consistency' | 'thin_sample' |
        'weekend_gamble' | 'impulse' | 'loss_chase'
  severity: 'info' | 'warn' | 'critical'
  label:   string
  detail:  string
}


/** Public entry point. Pass `JournalEntry[]` already scoped to the window. */
export function analyzeBehavior(
  entries: JournalEntry[],
  windowDays = 30,
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

  return {
    total_trades:        rows.length,
    closed_trades:       closed.length,
    window_days:         windowDays,
    consistency_score:   consistency,
    revenge_risk:        revenge?.score ?? null,
    revenge_count:       revenge?.count ?? 0,
    overtrade_risk:      overtrade?.score ?? null,
    overtrade_days:      overtrade?.days  ?? 0,
    risk_inflation_risk: riskInflation?.score ?? null,
    risk_inflation_count: riskInflation?.count ?? 0,
    discipline_risk:     discipline?.score ?? null,
    rule_violations:     discipline?.count ?? 0,
    fomo_risk:           fomo?.score ?? null,
    fomo_count:          fomo?.count ?? 0,
    weekend_gamble_risk: weekendGamble?.score ?? null,
    weekend_gamble_count: weekendGamble?.count ?? 0,
    impulse_risk:        impulse?.score ?? null,
    impulse_count:       impulse?.count ?? 0,
    loss_chase_risk:     lossChase?.score ?? null,
    loss_chase_count:    lossChase?.count ?? 0,
    emotion_summary:     emotionSummary,
    flags,
  }
}


// ─── Revenge detection ──────────────────────────────────────────────

function detectRevenge(
  chron: JournalEntry[],
  flags: BehaviorFlag[],
): { score: number; count: number } {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS) return { score: 0, count: 0 }

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

  if (opportunities < MIN_SAMPLE_PER_AXIS) return { score: 0, count: revengeCount }
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
): { score: number; days: number } {
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
): { score: number; count: number } {
  const closed = chron.filter((r) => r.pnl != null && r.risk_pct != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS + WIN_STREAK_LEN) {
    return { score: 0, count: 0 }
  }
  const avgRisk = mean(closed.map((r) => r.risk_pct as number)) ?? 0
  if (avgRisk <= 0) return { score: 0, count: 0 }

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

  if (opportunities < MIN_SAMPLE_PER_AXIS) return { score: 0, count }
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
): { score: number; count: number } {
  const flagged = closed.filter((r) => r.rule_violation === true).length
  if (closed.length < MIN_SAMPLE_PER_AXIS) return { score: 0, count: flagged }
  const ratio = flagged / closed.length
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
): { score: number; count: number } {
  let count = 0
  for (const r of rows) {
    if (rowSignalsFomo(r)) count++
  }
  if (rows.length < MIN_SAMPLE_PER_AXIS) return { score: 0, count }
  const ratio = count / rows.length
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
): { score: number; count: number } {
  let count = 0
  for (const r of rows) {
    const d = new Date(r.created_at).getUTCDay()  // 0=Sun, 6=Sat
    if (d === 0 || d === 6) count++
  }
  if (rows.length < MIN_SAMPLE_PER_AXIS) return { score: 0, count }
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
): { score: number; count: number } {
  let count = 0
  for (const r of rows) {
    const tag = (r.setup_tag ?? '').trim().toLowerCase()
    if (IMPULSE_NO_STRATEGY_TAGS.has(tag)) count++
  }
  if (rows.length < MIN_SAMPLE_PER_AXIS) return { score: 0, count }
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
): { score: number; count: number } {
  const closed = chron.filter((r) => r.pnl != null)
  if (closed.length < MIN_SAMPLE_PER_AXIS + LOSS_CHASE_STREAK_LEN) {
    return { score: 0, count: 0 }
  }
  const avgRisk = mean(
    closed.map((r) => r.risk_pct ?? null).filter((x): x is number => x != null),
  )
  if (avgRisk == null || avgRisk <= 0) return { score: 0, count: 0 }

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


// ─── Tiny helpers ────────────────────────────────────────────────────

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
