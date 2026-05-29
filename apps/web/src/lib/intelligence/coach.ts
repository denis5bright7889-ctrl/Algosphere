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

  // ─── Behavioral risks (highest priority) ─────────────────────────
  for (const f of behavior.flags) {
    insights.push(insightFromFlag(f))
  }

  // ─── Best & worst session / pair / setup edges ───────────────────
  pushBestEdge(insights, perf.by_session, 'session_edge', 'Your strongest session is')
  pushBestEdge(insights, perf.by_pair,    'pair_edge',    'Your highest-edge pair is')
  pushBestEdge(insights, perf.by_setup,   'setup_edge',   'Your best setup is')

  pushWorstEdge(insights, perf.by_session, 'session_edge', 'You bleed in')
  pushWorstEdge(insights, perf.by_pair,    'pair_edge',    'You overtrade')
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
