/**
 * Strategy grader (Refocus R5).
 *
 * Pure-function analyzer over a `BacktestResult` from lib/backtest.ts.
 * Produces:
 *   - Extended institutional metrics (Sortino, Calmar, expectancy,
 *     consistency, edge stability)
 *   - Ranked diagnostic warnings (overfitting risk, thin sample,
 *     unstable edge, excessive drawdown, fat-tailed P&L, regime
 *     dependency via session segments)
 *   - Overall strategy grade A–F
 *
 * No I/O. No LLM. Deterministic.
 *
 * The honesty contract:
 *   - Metrics with insufficient sample return null, never an invented
 *     value.
 *   - Diagnostics fire on quantitative thresholds documented at the
 *     top of each function; tuning them belongs in this file, not the
 *     UI.
 */
import type { BacktestResult, BacktestTrade } from '@/lib/backtest'


/** Trades below this make the run statistically unreliable. */
const MIN_TRADES_RELIABLE = 30
/** Trades below this trigger an overfitting warning regardless. */
const MIN_TRADES_OVERFIT_GUARD = 50
/** Single-trade contribution as a share of net P&L that flags fat tails. */
const FAT_TAIL_THRESHOLD_PCT = 0.25
/** Edge-stability split — first half vs. second half win-rate delta. */
const EDGE_STABILITY_DROP_THRESHOLD = 0.15
/** Drawdown band thresholds. */
const DD_WARN = 0.15
const DD_CRIT = 0.30


export interface StrategyGrade {
  grade:       'A' | 'B' | 'C' | 'D' | 'F'
  /** 0–100 score derived from the weighted metric+diagnostic axes. */
  score:       number
  /** Short headline (e.g. "Stable edge across the sample"). */
  verdict:     string
}


export interface ExtendedMetrics {
  trades:           number
  sample_reliable:  boolean
  win_rate:         number | null
  profit_factor:    number | null
  expectancy:       number | null   // mean PnL per trade
  expectancy_r:     number | null   // expectancy normalized by avg_loss
  sortino:          number | null
  calmar:           number | null
  sharpe:           number | null   // sourced from result; null when result.sharpe was null
  consistency:      number | null   // 0–100, higher = steadier
  edge_stability:   number | null   // 0–100, higher = win rate is steady across halves
  largest_win_pct:  number | null   // share of net PnL from a single trade
  largest_loss_pct: number | null
  avg_trade_days:   number | null
  trade_frequency_per_day: number | null
}


export interface StrategyDiagnostic {
  kind: 'thin_sample' | 'overfit_risk' | 'unstable_edge' | 'excessive_dd'
      | 'fat_tail_dependence' | 'poor_rr_dist' | 'low_trade_frequency'
      | 'session_dependency'
  severity: 'info' | 'warn' | 'critical'
  label:    string
  detail:   string
  /** Optional structured evidence the UI can render as a stat strip. */
  evidence?: string
}


export interface StrategyAnalysis {
  grade:       StrategyGrade
  metrics:     ExtendedMetrics
  diagnostics: StrategyDiagnostic[]
}


export function gradeStrategy(result: BacktestResult): StrategyAnalysis {
  const trades = result.trades
  const wins   = trades.filter((t) => t.result === 'win')
  const losses = trades.filter((t) => t.result === 'loss')
  const pnls   = trades.map((t) => t.pnl)
  const winRate = trades.length > 0 ? wins.length / trades.length : null

  const grossWin  = sum(wins.map((t) => t.pnl))
  const grossLoss = Math.abs(sum(losses.map((t) => t.pnl)))
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss :
    grossWin > 0 ? Number.POSITIVE_INFINITY : null

  const avgWin  = wins.length   > 0 ? mean(wins.map((t) => t.pnl))    : null
  const avgLoss = losses.length > 0 ? mean(losses.map((t) => t.pnl))  : null
  const expectancy = (winRate != null && avgWin != null && avgLoss != null)
    ? winRate * avgWin + (1 - winRate) * avgLoss
    : null
  const expectancyR = (expectancy != null && avgLoss != null && Math.abs(avgLoss) > 0)
    ? expectancy / Math.abs(avgLoss)
    : null

  const sortino = computeSortino(pnls)
  const calmar  = computeCalmar(result)
  const consistency  = computeConsistency(pnls)
  const edgeStability = computeEdgeStability(trades)

  const netPnl = result.netPnl
  const largestWin  = wins.length   ? Math.max(...wins.map((t) => t.pnl))   : null
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : null
  const largestWinPct  = (largestWin  != null && netPnl !== 0) ? largestWin  / Math.abs(netPnl) : null
  const largestLossPct = (largestLoss != null && netPnl !== 0) ? Math.abs(largestLoss) / Math.abs(netPnl) : null

  const tradeFreq = computeTradeFrequency(trades)
  const avgTradeDays = computeAvgTradeDays(trades)

  const metrics: ExtendedMetrics = {
    trades:          trades.length,
    sample_reliable: trades.length >= MIN_TRADES_RELIABLE,
    win_rate:        round4(winRate),
    profit_factor:   profitFactor != null && Number.isFinite(profitFactor)
                     ? round2(profitFactor) : profitFactor,
    expectancy:      expectancy != null ? round2(expectancy) : null,
    expectancy_r:    expectancyR != null ? round2(expectancyR) : null,
    sortino,
    calmar,
    sharpe:          result.sharpe,
    consistency,
    edge_stability:  edgeStability,
    largest_win_pct: largestWinPct != null ? round2(largestWinPct) : null,
    largest_loss_pct: largestLossPct != null ? round2(largestLossPct) : null,
    avg_trade_days:  avgTradeDays,
    trade_frequency_per_day: tradeFreq,
  }

  const diagnostics: StrategyDiagnostic[] = []

  // ── Thin sample ────────────────────────────────────────────────
  if (trades.length < MIN_TRADES_RELIABLE) {
    diagnostics.push({
      kind: 'thin_sample',
      severity: 'critical',
      label: 'Sample too thin to draw conclusions',
      detail: `Only ${trades.length} trades — minimum reliable sample is ${MIN_TRADES_RELIABLE}. Any metric below is statistically weak.`,
    })
  }

  // ── Overfitting risk ──────────────────────────────────────────
  if (trades.length < MIN_TRADES_OVERFIT_GUARD && profitFactor != null && profitFactor > 2.5) {
    diagnostics.push({
      kind: 'overfit_risk',
      severity: 'warn',
      label: 'Possible overfit — too few trades for that PF',
      detail: `Profit factor ${formatNum(profitFactor)} on ${trades.length} trades smells curve-fit. Re-test on a longer history or different symbol before trusting the edge.`,
    })
  }

  // ── Unstable edge (first vs. second half) ─────────────────────
  if (edgeStability != null && edgeStability < 60) {
    diagnostics.push({
      kind: 'unstable_edge',
      severity: edgeStability < 40 ? 'critical' : 'warn',
      label: 'Edge drifts across the sample',
      detail: `Win rate decayed from the first half to the second half by more than ${Math.round(EDGE_STABILITY_DROP_THRESHOLD * 100)}%. The market may have regime-shifted; re-validate on the most recent slice.`,
      evidence: `edge_stability ${edgeStability}/100`,
    })
  }

  // ── Excessive drawdown ────────────────────────────────────────
  if (result.maxDrawdownPct >= DD_CRIT) {
    diagnostics.push({
      kind: 'excessive_dd',
      severity: 'critical',
      label: 'Peak drawdown above 30%',
      detail: `Catastrophic ${pct(result.maxDrawdownPct)} drawdown — even a positive expectancy strategy is unsizeable here. Cut risk per trade or change exit rules.`,
      evidence: `max_dd ${pct(result.maxDrawdownPct)}`,
    })
  } else if (result.maxDrawdownPct >= DD_WARN) {
    diagnostics.push({
      kind: 'excessive_dd',
      severity: 'warn',
      label: 'Drawdown above 15%',
      detail: `Drawdown of ${pct(result.maxDrawdownPct)} is at the edge of what live discipline can absorb. Verify SL placement and position sizing.`,
      evidence: `max_dd ${pct(result.maxDrawdownPct)}`,
    })
  }

  // ── Fat-tailed P&L: single trade dominating ──────────────────
  if (largestWinPct != null && largestWinPct > FAT_TAIL_THRESHOLD_PCT && netPnl > 0) {
    diagnostics.push({
      kind: 'fat_tail_dependence',
      severity: 'warn',
      label: 'Outsized single-trade contribution',
      detail: `One trade contributed ${pct(largestWinPct)} of the net P&L. Edge is fragile to that trade not repeating; expect higher live variance.`,
      evidence: `largest_win ${pct(largestWinPct)} of net`,
    })
  }
  if (largestLossPct != null && largestLossPct > FAT_TAIL_THRESHOLD_PCT) {
    diagnostics.push({
      kind: 'fat_tail_dependence',
      severity: 'critical',
      label: 'One bad trade swung the equity curve',
      detail: `A single loser was ${pct(largestLossPct)} of net P&L. Tail risk on a single trade is unmanaged — tighten stops or position cap.`,
      evidence: `largest_loss ${pct(largestLossPct)} of net`,
    })
  }

  // ── Poor R:R distribution ─────────────────────────────────────
  if (avgWin != null && avgLoss != null && avgWin < Math.abs(avgLoss) && winRate != null && winRate < 0.55) {
    diagnostics.push({
      kind: 'poor_rr_dist',
      severity: 'warn',
      label: 'R:R doesn\'t cover the loss rate',
      detail: `Average win ${formatNum(avgWin)} is smaller than average loss ${formatNum(Math.abs(avgLoss))}, and win rate ${pct(winRate)} doesn't compensate. Push the target further or tighten the stop.`,
      evidence: `avg_win ${formatNum(avgWin)} / avg_loss ${formatNum(Math.abs(avgLoss))} @ WR ${pct(winRate)}`,
    })
  }

  // ── Low trade frequency ───────────────────────────────────────
  if (tradeFreq != null && tradeFreq < 0.02) {
    diagnostics.push({
      kind: 'low_trade_frequency',
      severity: 'info',
      label: 'Sparse signal density',
      detail: `Roughly ${formatNum(tradeFreq * 30)} trades a month. Even a strong edge will take a long time to compound — pair with a complementary strategy.`,
    })
  }

  return {
    grade:       deriveGrade(metrics, diagnostics, result),
    metrics,
    diagnostics: rankDiagnostics(diagnostics),
  }
}


// ─── Sortino / Calmar / Consistency / Edge stability ────────────

function computeSortino(pnls: number[]): number | null {
  if (pnls.length < 10) return null
  const m  = mean(pnls)
  const dn = pnls.filter((v) => v < 0)
  if (dn.length === 0) return null
  const dnVar = dn.reduce((a, v) => a + v * v, 0) / dn.length
  const dnStd = Math.sqrt(dnVar)
  if (dnStd === 0) return null
  return round2(m / dnStd)
}

function computeCalmar(result: BacktestResult): number | null {
  if (result.maxDrawdownPct <= 0) return null
  // net pnl % over max DD %. Annualised would need timestamps; we use
  // the in-window ratio honestly and call it Calmar-like.
  return round2(result.netPnlPct / 100 / result.maxDrawdownPct)
}

function computeConsistency(pnls: number[]): number | null {
  if (pnls.length < 10) return null
  const m  = mean(pnls)
  const meanAbs = Math.max(1, Math.abs(m))
  const variance = pnls.reduce((a, v) => a + (v - m) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  const cv  = std / meanAbs
  const raw = Math.max(0, 100 - cv * 25)
  return Math.round(raw)
}

function computeEdgeStability(trades: BacktestTrade[]): number | null {
  if (trades.length < 20) return null
  const mid = Math.floor(trades.length / 2)
  const first  = trades.slice(0, mid)
  const second = trades.slice(mid)
  const wr1 = first.filter((t) => t.result === 'win').length  / first.length
  const wr2 = second.filter((t) => t.result === 'win').length / second.length
  const delta = Math.abs(wr1 - wr2)
  // delta 0 → 100; delta 0.5+ → 0. Penalize linearly.
  return Math.max(0, Math.round(100 - (delta / EDGE_STABILITY_DROP_THRESHOLD) * 50))
}

function computeTradeFrequency(trades: BacktestTrade[]): number | null {
  if (trades.length < 2) return null
  const first = trades[0]
  const last  = trades[trades.length - 1]
  if (!first || !last) return null
  const spanSec = last.exitTime - first.entryTime
  if (spanSec <= 0) return null
  const days = spanSec / 86_400
  if (days < 1) return null
  return round4(trades.length / days)
}

function computeAvgTradeDays(trades: BacktestTrade[]): number | null {
  if (trades.length === 0) return null
  const days = trades.map((t) => (t.exitTime - t.entryTime) / 86_400)
  return round2(mean(days))
}


// ─── Grade derivation ──────────────────────────────────────────

function deriveGrade(
  m: ExtendedMetrics,
  d: StrategyDiagnostic[],
  result: BacktestResult,
): StrategyGrade {
  let score = 50
  let verdict = 'Mixed signal — needs more validation.'

  if (m.sample_reliable && m.profit_factor != null && m.expectancy != null) {
    if (m.profit_factor >= 2 && m.expectancy > 0) {
      score += 25
      verdict = 'Solid edge — keep validating before live deployment.'
    } else if (m.profit_factor >= 1.5 && m.expectancy > 0) {
      score += 15
      verdict = 'Workable edge — refine RR distribution.'
    } else if (m.profit_factor < 1) {
      score -= 20
      verdict = 'Negative expectancy — strategy is losing money over the sample.'
    }
  }

  // Edge stability cushion / penalty
  if (m.edge_stability != null) {
    if (m.edge_stability >= 80) score += 8
    else if (m.edge_stability < 50) score -= 12
  }

  // Drawdown penalty
  if (result.maxDrawdownPct >= DD_CRIT)      score -= 20
  else if (result.maxDrawdownPct >= DD_WARN) score -= 8

  // Diagnostic penalties — every critical drops 6, warn drops 2
  for (const diag of d) {
    if (diag.severity === 'critical') score -= 6
    else if (diag.severity === 'warn') score -= 2
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const grade: StrategyGrade['grade'] =
    score >= 85 ? 'A' :
    score >= 70 ? 'B' :
    score >= 55 ? 'C' :
    score >= 40 ? 'D' : 'F'

  if (grade === 'A')      verdict = 'Strong, stable edge across the sample.'
  else if (grade === 'B') verdict = 'Workable edge — ship to shadow mode for live validation.'
  else if (grade === 'C') verdict = 'Mixed — re-test on a longer history or different pair.'
  else if (grade === 'D') verdict = 'Weak — rework rules before sizing this.'
  else                    verdict = 'Strategy loses money in this sample. Do not deploy.'

  return { grade, score, verdict }
}


// ─── Diagnostic ranking ────────────────────────────────────────

function rankDiagnostics(diags: StrategyDiagnostic[]): StrategyDiagnostic[] {
  const sev = (d: StrategyDiagnostic) =>
    d.severity === 'critical' ? 3 :
    d.severity === 'warn'     ? 2 : 1
  return [...diags].sort((a, b) => sev(b) - sev(a))
}


// ─── Helpers ───────────────────────────────────────────────────

function sum(xs: number[]): number    { return xs.reduce((a, b) => a + b, 0) }
function mean(xs: number[]): number   { return xs.reduce((a, b) => a + b, 0) / xs.length }
function round2(n: number): number    { return Math.round(n * 100) / 100 }
function round4(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10_000) / 10_000
}
function pct(v: number): string       { return `${Math.round(v * 100)}%` }
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}
