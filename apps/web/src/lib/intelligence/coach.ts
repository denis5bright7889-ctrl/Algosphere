/**
 * Narrative coach insights for the Trader Intelligence Dashboard
 * (Refocus R4).
 *
 * Takes the behavioral + performance reports and emits a small ranked
 * set of plain-English observations. Pure function. No LLM call —
 * these are deterministic, derived insights so the dashboard never
 * fabricates a take, never blocks on an external API, and is honest
 * about "insufficient data" states.
 *
 * If the user later wants a generative second pass (the existing
 * /psychology page already calls Gemini), the deterministic feed
 * here grounds the prompt — see lib/ai-signal-commentary for the
 * pattern.
 *
 * Output contract:
 *   { kind, severity, headline, detail, evidence? }
 *
 * - `headline` is the one-line takeaway (UI shows this first).
 * - `detail` is the supporting explanation (1-2 sentences).
 * - `evidence` is optional structured data the UI can render as a
 *   tiny stat strip ("12 trades · 67% WR · +0.41 R expectancy").
 */
import type { BehavioralReport, BehaviorFlag } from './behavioral'
import type { PerformanceReport, SegmentRow } from './performance'
import type { JournalEntry } from '@/lib/types'


export type InsightKind =
  | 'streak'
  | 'session_edge'
  | 'pair_edge'
  | 'setup_edge'
  | 'dow_edge'
  | 'risk_inflation'
  | 'revenge'
  | 'overtrade'
  | 'discipline'
  | 'consistency'
  | 'thin_sample'
  | 'drawdown'
  | 'profit_factor'
  | 'current_streak'
  | 'pair_cap'


export interface CoachInsight {
  kind:      InsightKind
  severity:  'info' | 'good' | 'warn' | 'critical'
  headline:  string
  detail:    string
  evidence?: string
}


export function generateInsights(
  behavior: BehavioralReport,
  perf:     PerformanceReport,
  /** Chronological journal entries (newest-first OR oldest-first; we
   *  sort defensively). When provided, the coach emits sharper, more
   *  contextual recommendations — current streak, pair-specific risk
   *  caps. Optional for backwards compatibility. */
  entries?: JournalEntry[],
): CoachInsight[] {
  const insights: CoachInsight[] = []

  if (behavior.closed_trades < 8) {
    insights.push({
      kind: 'thin_sample',
      severity: 'info',
      headline: 'Log more trades before relying on these insights.',
      detail: `Coach analysis becomes meaningful at 8+ closed trades. Have ${behavior.closed_trades}.`,
    })
    return insights
  }

  // ─── Current streak (contextual — top priority for the user RIGHT NOW) ─
  if (entries && entries.length > 0) {
    const streak = currentStreak(entries)
    if (streak.run <= -3) {
      insights.push({
        kind: 'current_streak',
        severity: streak.run <= -5 ? 'critical' : 'warn',
        headline: `${Math.abs(streak.run)} losses in a row — halve your size.`,
        detail: streak.run <= -5
          ? `Cap risk at 0.25% per trade until you book a winner. Step away from the screen if the next entry is impulsive — a sixth loss is rarely a setup, it's tilt.`
          : `Cap risk at 0.5% per trade until you book a winner. Don't size up to chase the drawdown back.`,
        evidence: `Last ${Math.abs(streak.run)} closed trades · all losing · sequence ends ${streak.lastDate ?? 'recently'}`,
      })
    } else if (streak.run >= 5) {
      insights.push({
        kind: 'current_streak',
        severity: 'info',
        headline: `${streak.run} wins in a row — don't scale up.`,
        detail: `Stick to your normal size. After-win risk inflation is the highest-correlation predictor of a giveback trade in this dataset.`,
        evidence: `Last ${streak.run} closed trades · all winning`,
      })
    }
  }

  // ─── Behavioral risks (highest priority) ─────────────────────────
  for (const f of behavior.flags) {
    insights.push(insightFromFlag(f))
  }

  // ─── Best & worst session / pair / setup edges ───────────────────
  pushBestEdge(insights, perf.by_session, 'session_edge', 'Your strongest session is')
  pushBestEdge(insights, perf.by_pair,    'pair_edge',    'Your highest-edge pair is')
  pushBestEdge(insights, perf.by_setup,   'setup_edge',   'Your best setup is')

  pushWorstEdge(insights, perf.by_session, 'session_edge', 'You bleed in')
  pushPairCap (insights, perf.by_pair)
  pushWorstEdge(insights, perf.by_setup,   'setup_edge',   'Your worst setup is')

  // ─── Day-of-week edge ────────────────────────────────────────────
  pushBestEdge(insights, perf.by_dow, 'dow_edge', 'Your best day is')

  // ─── Overall profit factor / expectancy headline ─────────────────
  if (perf.profit_factor != null && perf.expectancy != null && perf.closed_trades >= 10) {
    if (perf.profit_factor >= 1.5 && perf.expectancy > 0) {
      insights.push({
        kind: 'profit_factor',
        severity: 'good',
        headline: 'Edge is real.',
        detail: `Profit factor ${formatNum(perf.profit_factor)} with positive expectancy across ${perf.closed_trades} trades. Keep the framework; resist drift.`,
        evidence: `${perf.closed_trades} trades · PF ${formatNum(perf.profit_factor)} · E ${formatNum(perf.expectancy)}`,
      })
    } else if (perf.profit_factor < 1) {
      insights.push({
        kind: 'profit_factor',
        severity: 'critical',
        headline: 'You\'re paying to play.',
        detail: `Profit factor ${formatNum(perf.profit_factor)} means losses outweigh wins. Tighten entries and review your worst pair before adding size.`,
        evidence: `${perf.closed_trades} trades · PF ${formatNum(perf.profit_factor)} · E ${formatNum(perf.expectancy ?? 0)}`,
      })
    }
  }

  // ─── Drawdown ────────────────────────────────────────────────────
  if (perf.max_drawdown_pct != null && perf.max_drawdown_pct >= 0.2) {
    insights.push({
      kind: 'drawdown',
      severity: 'warn',
      headline: 'Drawdown above 20% — protect capital.',
      detail: `Peak-to-trough dropdown of ${pct(perf.max_drawdown_pct)} this window. Cut size by half until you string two clean weeks together.`,
      evidence: `Max DD ${pct(perf.max_drawdown_pct)} (${formatNum(perf.max_drawdown)})`,
    })
  }

  // ─── Discipline cheer ────────────────────────────────────────────
  if (
    behavior.consistency_score != null && behavior.consistency_score >= 65 &&
    behavior.rule_violations === 0 && behavior.closed_trades >= 12
  ) {
    insights.push({
      kind: 'consistency',
      severity: 'good',
      headline: 'Clean discipline streak.',
      detail: `Consistency ${behavior.consistency_score}/100 with zero rule violations across ${behavior.closed_trades} trades.`,
    })
  }

  // Cap output so the UI stays scannable.
  return rank(insights).slice(0, 8)
}


// ─── Mappers ─────────────────────────────────────────────────────────

function insightFromFlag(f: BehaviorFlag): CoachInsight {
  // Map BehaviorFlag.kind → InsightKind narrowed below.
  const k: InsightKind = f.kind === 'thin_sample'   ? 'thin_sample'
                      : f.kind === 'revenge'         ? 'revenge'
                      : f.kind === 'overtrade'       ? 'overtrade'
                      : f.kind === 'risk_inflation'  ? 'risk_inflation'
                      : f.kind === 'rule_violation'  ? 'discipline'
                      : 'consistency'
  return {
    kind: k,
    severity: f.severity === 'info' ? 'info' : f.severity === 'warn' ? 'warn' : 'critical',
    headline: f.label,
    detail:   f.detail,
  }
}


function pushBestEdge(
  out: CoachInsight[],
  rows: SegmentRow[],
  kind: InsightKind,
  prefix: string,
) {
  const r = rows.find((x) => x.reliable && (x.expectancy ?? -Infinity) > 0)
  if (!r) return
  out.push({
    kind,
    severity: 'good',
    headline: `${prefix} ${r.key}.`,
    detail: `Win rate ${pct(r.win_rate ?? 0)} · expectancy ${formatNum(r.expectancy ?? 0)} across ${r.trades} trades. Lean into this when conditions align.`,
    evidence: `${r.trades} trades · ${pct(r.win_rate ?? 0)} WR · E ${formatNum(r.expectancy ?? 0)} · PnL ${formatNum(r.total_pnl)}`,
  })
}

function pushWorstEdge(
  out: CoachInsight[],
  rows: SegmentRow[],
  kind: InsightKind,
  prefix: string,
) {
  const r = [...rows].reverse().find(
    (x) => x.reliable && (x.expectancy ?? Infinity) < 0,
  )
  if (!r) return
  out.push({
    kind,
    severity: 'warn',
    headline: `${prefix} ${r.key}.`,
    detail: `${r.trades} trades, win rate ${pct(r.win_rate ?? 0)}, expectancy ${formatNum(r.expectancy ?? 0)}. Take a break from this slot until the data turns.`,
    evidence: `${r.trades} trades · ${pct(r.win_rate ?? 0)} WR · E ${formatNum(r.expectancy ?? 0)} · PnL ${formatNum(r.total_pnl)}`,
  })
}

/** Specific pair-risk recommendation: when a pair has reliably-negative
 *  expectancy, suggest a concrete cap (0.3% / 0.5%) rather than a generic
 *  "take a break". The cap scales with how bad the bleed is. */
function pushPairCap(out: CoachInsight[], rows: SegmentRow[]) {
  const r = [...rows].reverse().find(
    (x) => x.reliable && (x.expectancy ?? Infinity) < 0,
  )
  if (!r) return
  const ev = r.expectancy ?? 0
  // Worse expectancy → tighter cap.
  const cap = ev <= -1   ? '0.25%'
            : ev <= -0.5 ? '0.3%'
            :              '0.5%'
  out.push({
    kind: 'pair_cap',
    severity: 'warn',
    headline: `Cap risk on ${r.key} at ${cap} per trade.`,
    detail: `Negative expectancy across ${r.trades} trades — ${pct(r.win_rate ?? 0)} win rate and ${formatNum(ev)} R per trade. ${cap} keeps you in the game while the data turns; don't size up here until expectancy crosses zero.`,
    evidence: `${r.trades} trades · ${pct(r.win_rate ?? 0)} WR · E ${formatNum(ev)} · PnL ${formatNum(r.total_pnl)}`,
  })
}

/** Current win/loss streak from the user's most recent trades. Positive
 *  = winning streak, negative = losing streak. Returns `lastDate` so the
 *  insight can ground the user in real time. */
function currentStreak(entries: JournalEntry[]): {
  run: number
  lastDate: string | null
} {
  // Defensive sort newest-first regardless of caller's order.
  const sorted = [...entries].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  )
  let run = 0
  let lastDate: string | null = null
  for (const e of sorted) {
    if (e.pnl == null) continue                  // open / break-even-undefined
    const win  = e.pnl > 0
    const loss = e.pnl < 0
    if (!win && !loss) break                     // exact break-even ends the run
    if (run === 0) {
      run = win ? 1 : -1
      lastDate = formatDate(e.trade_date ?? e.created_at)
    } else if ((run > 0 && win) || (run < 0 && loss)) {
      run = win ? run + 1 : run - 1
    } else {
      break
    }
  }
  return { run, lastDate }
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}


// ─── Ranking + formatting ────────────────────────────────────────────

function rank(items: CoachInsight[]): CoachInsight[] {
  // critical > warn > good > info; behavioral risks beat performance
  // cheers when severity ties.
  const sev = (i: CoachInsight) =>
    i.severity === 'critical' ? 3 :
    i.severity === 'warn'     ? 2 :
    i.severity === 'good'     ? 1 : 0
  const behaviorScore = (i: CoachInsight) =>
    i.kind === 'revenge' || i.kind === 'overtrade' || i.kind === 'risk_inflation' ||
    i.kind === 'discipline' || i.kind === 'consistency' ? 1 : 0
  return items.sort((a, b) => {
    if (sev(b) !== sev(a)) return sev(b) - sev(a)
    return behaviorScore(b) - behaviorScore(a)
  })
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toFixed(2)
}
