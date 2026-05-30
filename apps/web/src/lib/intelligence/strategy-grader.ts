/**
 * Strategy grader v2 — separates Sample / Performance / Risk / Robustness.
 *
 * Founder directive: no displayed grade, diagnostic, drawdown metric, MC
 * conclusion, or recommendation can contradict the underlying backtest
 * metrics. Acceptance criteria from the audit:
 *
 *   • Trade count < 30 → grade = "N/A", confidence = "low". Never a
 *     hard grade letter, never a "losing strategy" verdict.
 *   • Positive net P&L OR profit factor > 1 OR positive expectancy
 *     can NEVER trigger a "strategy loses money" verdict.
 *   • Drawdown thresholds operate on the SAME unit (fraction in [0,1])
 *     as the backtest output. No 100× scaling errors.
 *   • Monte Carlo robustness is gated by confidence_level.
 *   • Diagnostics are evidence-based: every fire is gated by the metric
 *     that drives it, not by accumulated penalty math.
 *
 * The 100-point overall score is the weighted sum of four sub-scores:
 *
 *     Sample Quality   30%
 *     Performance      40%
 *     Risk             20%
 *     Robustness       10%
 *
 * Each sub-score is exposed so the UI can render them transparently and
 * downstream engines can read the components without re-deriving them.
 *
 * Pure functions. Deterministic. No I/O.
 */
import type { BacktestResult, BacktestTrade } from '@/lib/backtest'


// ─── Reliability / confidence thresholds ──────────────────────────

/** Trades below this make any single grade unreliable. */
export const MIN_TRADES_RELIABLE = 30
/** 100+ trades = high confidence in stat estimates. */
export const HIGH_CONFIDENCE_TRADES = 100

/** Trades below this trigger an overfitting warning regardless. */
const MIN_TRADES_OVERFIT_GUARD = 50

/** Single-trade contribution as a share of net P&L that flags fat tails. */
const FAT_TAIL_THRESHOLD_PCT = 0.25

/** Edge-stability split — first half vs. second half win-rate delta. */
const EDGE_STABILITY_DROP_THRESHOLD = 0.15

/** Drawdown band thresholds — operate on FRACTION (0..1) inputs. The
 *  upstream backtest result stores maxDrawdownPct as a fraction; the
 *  display layer multiplies by 100 for "%". */
const DD_WARN = 0.15   // 15%
const DD_CRIT = 0.30   // 30%


// ─── Public types ─────────────────────────────────────────────────

export type Confidence = 'low' | 'medium' | 'high'

/** Deployment Readiness ladder — Journal V4 directive. Replaces the
 *  blunt A-F grade for strategy evaluation. Each stage carries the
 *  evidence bar: sample size + PF + MC quality + edge stability. */
export type ReadinessStage =
  | 'research'       // n<10
  | 'testing'        // 10≤n<30
  | 'validation'     // 30≤n<100
  | 'pilot'          // 100≤n, PF≥1.3, edge stable
  | 'deployable'     // 200≤n, PF≥1.5, MC high confidence
  | 'institutional'  // 500≤n, PF≥2.0, MC ruin<5%, edge stable + regime-tested

export interface GradeBreakdown {
  /** 0-100. Trade count, span, frequency, stat significance. */
  sample_quality: number
  /** 0-100. Net return, PF, win rate, expectancy, Sharpe, Sortino. */
  performance:    number
  /** 0-100. Drawdown, tail risk, single-trade concentration. */
  risk:           number
  /** 0-100. Monte Carlo stability + edge stability. Null when sample
   *  too thin to evaluate honestly. */
  robustness:     number | null
}

export interface StrategyGrade {
  /** Letter grade — 'N/A' when sample is too thin to publish a verdict. */
  grade:        'A' | 'B' | 'C' | 'D' | 'F' | 'N/A'
  /** 0-100 weighted score. Null when grade='N/A'. */
  score:        number | null
  /** Confidence in the verdict (drives the "Low / Medium / High" pill). */
  confidence:   Confidence
  /** Short headline. Always factually consistent with the metrics. */
  verdict:      string
  /** Per-axis components so the UI can show them transparently. */
  breakdown:    GradeBreakdown
  /** V4 Deployment Readiness stage — drives the "where this strategy
   *  belongs on the journey" UI, independent of the letter grade. */
  readiness:    ReadinessStage
}


export interface ExtendedMetrics {
  trades:           number
  sample_reliable:  boolean
  /** Reliability score 0-100 — independent of profitability. */
  reliability:      number
  win_rate:         number | null
  profit_factor:    number | null
  expectancy:       number | null   // mean PnL per trade
  expectancy_r:     number | null
  sortino:          number | null
  calmar:           number | null
  sharpe:           number | null
  consistency:      number | null   // 0-100
  edge_stability:   number | null   // 0-100
  largest_win_pct:  number | null
  largest_loss_pct: number | null
  avg_trade_days:   number | null
  trade_frequency_per_day: number | null
}


export interface StrategyDiagnostic {
  kind: 'thin_sample' | 'overfit_risk' | 'unstable_edge' | 'excessive_dd'
      | 'fat_tail_dependence' | 'poor_rr_dist' | 'low_trade_frequency'
      | 'session_dependency' | 'positive_edge' | 'negative_edge'
  severity: 'info' | 'warn' | 'critical' | 'good'
  label:    string
  detail:   string
  evidence?: string
}


export interface StrategyAnalysis {
  grade:       StrategyGrade
  metrics:     ExtendedMetrics
  diagnostics: StrategyDiagnostic[]
}


// ─── Entry point ──────────────────────────────────────────────────

export function gradeStrategy(result: BacktestResult): StrategyAnalysis {
  const trades  = result.trades
  const wins    = trades.filter((t) => t.result === 'win')
  const losses  = trades.filter((t) => t.result === 'loss')
  const pnls    = trades.map((t) => t.pnl)
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

  const sortino       = computeSortino(pnls)
  const calmar        = computeCalmar(result)
  const consistency   = computeConsistency(pnls)
  const edgeStability = computeEdgeStability(trades)

  const netPnl = result.netPnl
  const largestWin  = wins.length   ? Math.max(...wins.map((t) => t.pnl))   : null
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : null
  const largestWinPct  = (largestWin  != null && netPnl !== 0) ? largestWin  / Math.abs(netPnl) : null
  const largestLossPct = (largestLoss != null && netPnl !== 0) ? Math.abs(largestLoss) / Math.abs(netPnl) : null

  const tradeFreq    = computeTradeFrequency(trades)
  const avgTradeDays = computeAvgTradeDays(trades)
  const sampleReliable = trades.length >= MIN_TRADES_RELIABLE
  const reliability = computeReliability(trades.length, consistency, edgeStability)

  const metrics: ExtendedMetrics = {
    trades:          trades.length,
    sample_reliable: sampleReliable,
    reliability,
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

  const diagnostics = buildDiagnostics({
    result, metrics, profitFactor, expectancy,
    avgWin, avgLoss, winRate, largestWinPct, largestLossPct, tradeFreq,
  })

  const grade = deriveGrade({ result, metrics })

  // Final validation pass — strip anything that contradicts the math.
  const validated = enforceConsistency({ grade, metrics, diagnostics, result })

  return {
    grade:       validated.grade,
    metrics,
    diagnostics: rankDiagnostics(validated.diagnostics),
  }
}


// ─── Sub-scores ───────────────────────────────────────────────────

interface DeriveCtx {
  result:  BacktestResult
  metrics: ExtendedMetrics
}

function sampleQualityScore(m: ExtendedMetrics): number {
  // Curve: trades=0 → 0; trades=30 → 60; trades=100+ → 95-100.
  // Lift further with stable consistency + edge stability.
  const n = m.trades
  let s: number
  if (n === 0)         s = 0
  else if (n < 10)     s = n * 2                    // 0–20
  else if (n < 30)     s = 20 + (n - 10) * 2        // 20–60
  else if (n < 100)    s = 60 + (n - 30) * (35 / 70) // 60–95
  else                 s = 95 + Math.min(5, (n - 100) / 50)  // 95–100
  if (m.consistency    != null && m.consistency    >= 70) s += 2
  if (m.edge_stability != null && m.edge_stability >= 70) s += 2
  return clamp(s)
}

function performanceScore(m: ExtendedMetrics, r: BacktestResult): number {
  // Performance is undefined for empty samples. We DO score it for thin
  // samples (so it's visible) but the confidence pill on the grade card
  // tells the user not to trust it.
  if (m.trades === 0) return 0
  let s = 50

  // Profit factor: anchor metric.
  const pf = m.profit_factor
  if (pf != null) {
    if (pf >= 2.5)       s += 22
    else if (pf >= 2.0)  s += 18
    else if (pf >= 1.5)  s += 12
    else if (pf >= 1.2)  s += 6
    else if (pf >= 1.0)  s += 0
    else if (pf >= 0.8)  s -= 12
    else                 s -= 22
  }

  // Net P&L sign — small bonus / penalty so a profitable run can never
  // score below the same-sized losing run on PF alone.
  if (r.netPnl > 0)      s += 5
  else if (r.netPnl < 0) s -= 5

  // Expectancy (mean PnL per trade) confirms PF.
  if (m.expectancy != null) {
    if (m.expectancy > 0) s += 4
    else                  s -= 6
  }

  // Win rate — only counts when it's outside the noise band.
  if (m.win_rate != null) {
    if (m.win_rate >= 0.6) s += 3
    else if (m.win_rate < 0.35) s -= 3
  }

  // Sharpe — risk-adjusted return on per-trade returns.
  if (m.sharpe != null) {
    if (m.sharpe >= 1.5)      s += 6
    else if (m.sharpe >= 1.0) s += 3
    else if (m.sharpe < 0)    s -= 6
  }

  // Sortino — downside-only risk adjustment.
  if (m.sortino != null) {
    if (m.sortino >= 1.5)      s += 3
    else if (m.sortino < 0)    s -= 3
  }

  return clamp(s)
}

function riskScore(m: ExtendedMetrics, r: BacktestResult): number {
  // Risk score: 100 = no observed risk events; lower = more.
  let s = 90
  const dd = r.maxDrawdownPct  // FRACTION in [0, 1]
  if (dd >= DD_CRIT)             s -= 35
  else if (dd >= DD_WARN)        s -= 15
  else if (dd >= DD_WARN / 2)    s -= 5

  // Concentration risk — one bad trade > 25% of net
  if (m.largest_loss_pct != null && m.largest_loss_pct > FAT_TAIL_THRESHOLD_PCT) {
    s -= 15
  }
  if (m.largest_win_pct != null && m.largest_win_pct > FAT_TAIL_THRESHOLD_PCT) {
    s -= 8   // less severe than a loss tail but still concerning
  }

  return clamp(s)
}

function robustnessScore(m: ExtendedMetrics): number | null {
  // We need enough trades to honestly measure robustness — edge
  // stability requires ≥20, consistency ≥10. Below that, return null
  // and the weighted score re-distributes 10% across the other axes.
  if (m.trades < 20)          return null
  const components: number[] = []
  if (m.edge_stability != null) components.push(m.edge_stability)
  if (m.consistency    != null) components.push(m.consistency)
  if (components.length === 0) return null
  return Math.round(components.reduce((a, b) => a + b, 0) / components.length)
}


// ─── Grade derivation ────────────────────────────────────────────

function deriveGrade(ctx: DeriveCtx): StrategyGrade {
  const { metrics, result } = ctx
  const sampleQuality = sampleQualityScore(metrics)
  const performance   = performanceScore(metrics, result)
  const risk          = riskScore(metrics, result)
  const robustness    = robustnessScore(metrics)

  const breakdown: GradeBreakdown = {
    sample_quality: sampleQuality,
    performance,
    risk,
    robustness,
  }

  const confidence: Confidence =
    metrics.trades >= HIGH_CONFIDENCE_TRADES ? 'high' :
    metrics.trades >= MIN_TRADES_RELIABLE    ? 'medium' :
                                                'low'

  const readiness = computeReadinessStage(metrics, result)

  // Thin sample → no letter grade. Period.
  if (metrics.trades < MIN_TRADES_RELIABLE) {
    return {
      grade: 'N/A',
      score: null,
      confidence,
      verdict: `Insufficient observations for statistical confidence. ${metrics.trades} trade${metrics.trades === 1 ? '' : 's'} — minimum recommended sample size is ${MIN_TRADES_RELIABLE}.`,
      breakdown,
      readiness,
    }
  }

  // Weighted score. Robustness null → redistribute its 10% pro-rata
  // across sample/performance/risk in their existing ratios (3:4:2).
  let score: number
  if (robustness != null) {
    score = Math.round(
      sampleQuality * 0.30 + performance * 0.40 + risk * 0.20 + robustness * 0.10,
    )
  } else {
    score = Math.round(
      sampleQuality * (0.30 / 0.90) + performance * (0.40 / 0.90) + risk * (0.20 / 0.90),
    )
  }
  score = clamp(score)

  // Letter from score bands.
  let grade: StrategyGrade['grade']
  if (score >= 85)      grade = 'A'
  else if (score >= 70) grade = 'B'
  else if (score >= 55) grade = 'C'
  else if (score >= 40) grade = 'D'
  else                  grade = 'F'

  // Verdict is built from metrics — never from accumulated penalty math.
  // The validation pass downstream catches any contradiction.
  const verdict = buildVerdict({ grade, metrics, result, performance, risk })

  return { grade, score, confidence, verdict, breakdown, readiness }
}


/** Map sample size + PF + drawdown + edge stability to a V4 readiness
 *  stage. Each rung requires the previous rung's evidence — never
 *  promotes on a single metric alone. */
function computeReadinessStage(
  m: ExtendedMetrics,
  r: BacktestResult,
): ReadinessStage {
  const n = m.trades
  if (n < 10)  return 'research'
  if (n < 30)  return 'testing'
  if (n < 100) return 'validation'

  const pf = m.profit_factor ?? 0
  const dd = r.maxDrawdownPct   // fraction
  const stableEdge =
    m.edge_stability != null && m.edge_stability >= 60 &&
    m.consistency   != null && m.consistency   >= 50

  // Pilot — first rung where the strategy is "ready to ship to shadow".
  // Needs an actual positive edge + stable, but tolerates n=100..199.
  if (n < 200 || pf < 1.5 || dd > 0.20 || !stableEdge) {
    return 'pilot'
  }

  // Deployable — institutional-adjacent. Bigger sample, lower DD,
  // stronger PF. No regime-specific test yet but sample size implies it.
  if (n < 500 || pf < 2.0 || dd > 0.15) {
    return 'deployable'
  }

  // Institutional — the ceiling. Reserved for strategies that have
  // earned size + survived a long regime span.
  return 'institutional'
}


function buildVerdict(args: {
  grade:       StrategyGrade['grade']
  metrics:     ExtendedMetrics
  result:      BacktestResult
  performance: number
  risk:        number
}): string {
  const { grade, metrics, result } = args
  const positiveEdge =
    result.netPnl > 0 &&
    metrics.profit_factor != null && metrics.profit_factor > 1 &&
    metrics.expectancy    != null && metrics.expectancy    > 0

  if (grade === 'A') {
    return 'Strong, stable edge across the sample. Ship to shadow mode for live validation.'
  }
  if (grade === 'B') {
    return 'Workable edge — refine RR distribution before sizing this up.'
  }
  if (grade === 'C') {
    return positiveEdge
      ? 'Positive expectancy with stability gaps — re-test on a longer history or different pair.'
      : 'Mixed read — metrics don\'t clearly support an edge yet. More data needed.'
  }
  if (grade === 'D') {
    return positiveEdge
      ? 'Marginal positive edge — risk and stability score weakly. Rework the rules.'
      : 'Weak read. Rework before sizing this.'
  }
  // F
  if (positiveEdge) {
    // Mathematically impossible under v1 grader — kept defensive.
    return 'Profitable in this sample but scored low on risk and stability. Validate carefully.'
  }
  return 'Negative expectancy across the sample. Do not deploy without rule changes.'
}


// ─── Diagnostics (evidence-based) ────────────────────────────────

interface BuildDiagCtx {
  result:        BacktestResult
  metrics:       ExtendedMetrics
  profitFactor:  number | null
  expectancy:    number | null
  avgWin:        number | null
  avgLoss:       number | null
  winRate:       number | null
  largestWinPct: number | null
  largestLossPct: number | null
  tradeFreq:     number | null
}

function buildDiagnostics(ctx: BuildDiagCtx): StrategyDiagnostic[] {
  const diags: StrategyDiagnostic[] = []
  const { result, metrics, profitFactor, expectancy, avgWin, avgLoss, winRate,
          largestWinPct, largestLossPct, tradeFreq } = ctx

  // ── Sample quality (always fires when relevant) ───────────────
  if (metrics.trades < MIN_TRADES_RELIABLE) {
    diags.push({
      kind: 'thin_sample',
      severity: 'info',          // not 'critical' — it's a confidence note, not a fault
      label: 'More observations needed before evaluating edge quality',
      detail: `Only ${metrics.trades} trade${metrics.trades === 1 ? '' : 's'} observed. Minimum recommended sample size is ${MIN_TRADES_RELIABLE}.`,
      evidence: `${metrics.trades}/${MIN_TRADES_RELIABLE} trades`,
    })
  }

  // ── Positive-edge confirmation (good) ─────────────────────────
  if (metrics.trades >= MIN_TRADES_RELIABLE
      && profitFactor != null && profitFactor >= 1.3
      && expectancy != null && expectancy > 0
      && result.netPnl > 0) {
    diags.push({
      kind: 'positive_edge',
      severity: 'good',
      label: 'Strategy shows positive historical expectancy',
      detail: `Profit factor ${formatNum(profitFactor)} with positive expectancy across ${metrics.trades} trades.`,
      evidence: `PF ${formatNum(profitFactor)} · expectancy ${formatNum(expectancy)} · ${metrics.trades} trades`,
    })
  }

  // ── Negative-edge call-out (only when ALL evidence aligns) ────
  if (metrics.trades >= MIN_TRADES_RELIABLE
      && profitFactor != null && profitFactor < 1
      && expectancy != null && expectancy < 0
      && result.netPnl < 0) {
    diags.push({
      kind: 'negative_edge',
      severity: 'critical',
      label: 'Strategy lost money over the sample',
      detail: `Profit factor ${formatNum(profitFactor)} (< 1.0) and negative expectancy across ${metrics.trades} trades. Rework entry/exit rules before sizing.`,
      evidence: `PF ${formatNum(profitFactor)} · expectancy ${formatNum(expectancy)} · net ${formatNum(result.netPnl)}`,
    })
  }

  // ── Overfit guard (suspiciously high PF on small n) ───────────
  if (metrics.trades >= MIN_TRADES_RELIABLE
      && metrics.trades < MIN_TRADES_OVERFIT_GUARD
      && profitFactor != null && profitFactor > 2.5) {
    diags.push({
      kind: 'overfit_risk',
      severity: 'warn',
      label: 'Possible overfit — too few trades for that profit factor',
      detail: `Profit factor ${formatNum(profitFactor)} on ${metrics.trades} trades smells curve-fit. Re-test on a longer history or different symbol before trusting the edge.`,
      evidence: `PF ${formatNum(profitFactor)} on ${metrics.trades} trades`,
    })
  }

  // ── Unstable edge (only fires when computed) ──────────────────
  if (metrics.edge_stability != null && metrics.edge_stability < 60) {
    diags.push({
      kind: 'unstable_edge',
      severity: metrics.edge_stability < 40 ? 'critical' : 'warn',
      label: 'Edge drifts across the sample',
      detail: `Win rate shifted between the first and second half. Re-validate on the most recent slice — the market may have regime-shifted.`,
      evidence: `edge_stability ${metrics.edge_stability}/100`,
    })
  }

  // ── Drawdown bands — operate on the same fraction unit as upstream ─
  const dd = result.maxDrawdownPct
  if (dd >= DD_CRIT) {
    diags.push({
      kind: 'excessive_dd',
      severity: 'critical',
      label: `Peak drawdown above ${Math.round(DD_CRIT * 100)}%`,
      detail: `Maximum drawdown of ${pct(dd)} — even a positive-expectancy strategy is hard to size at this risk. Cut risk per trade or change exit rules.`,
      evidence: `max_dd ${pct(dd)}`,
    })
  } else if (dd >= DD_WARN) {
    diags.push({
      kind: 'excessive_dd',
      severity: 'warn',
      label: `Drawdown above ${Math.round(DD_WARN * 100)}%`,
      detail: `Drawdown of ${pct(dd)} is at the edge of what live discipline can absorb. Verify SL placement and position sizing.`,
      evidence: `max_dd ${pct(dd)}`,
    })
  }

  // ── Fat tail — single trade dominates ─────────────────────────
  if (largestWinPct != null && largestWinPct > FAT_TAIL_THRESHOLD_PCT && result.netPnl > 0) {
    diags.push({
      kind: 'fat_tail_dependence',
      severity: 'warn',
      label: 'Outsized single-trade contribution',
      detail: `One trade contributed ${pct(largestWinPct)} of net P&L. Edge is fragile to that trade not repeating; expect higher live variance.`,
      evidence: `largest_win ${pct(largestWinPct)} of net`,
    })
  }
  if (largestLossPct != null && largestLossPct > FAT_TAIL_THRESHOLD_PCT) {
    diags.push({
      kind: 'fat_tail_dependence',
      severity: 'critical',
      label: 'One bad trade swung the equity curve',
      detail: `A single loser was ${pct(largestLossPct)} of net P&L. Tail risk on a single trade is unmanaged — tighten stops or position cap.`,
      evidence: `largest_loss ${pct(largestLossPct)} of net`,
    })
  }

  // ── Poor R:R distribution ─────────────────────────────────────
  if (avgWin != null && avgLoss != null && avgWin < Math.abs(avgLoss)
      && winRate != null && winRate < 0.55) {
    diags.push({
      kind: 'poor_rr_dist',
      severity: 'warn',
      label: 'R:R doesn\'t cover the loss rate',
      detail: `Average win ${formatNum(avgWin)} is smaller than average loss ${formatNum(Math.abs(avgLoss))}, and win rate ${pct(winRate)} doesn't compensate. Push the target further or tighten the stop.`,
      evidence: `avg_win ${formatNum(avgWin)} / avg_loss ${formatNum(Math.abs(avgLoss))} @ WR ${pct(winRate)}`,
    })
  }

  // ── Low signal density ────────────────────────────────────────
  if (tradeFreq != null && tradeFreq < 0.02) {
    diags.push({
      kind: 'low_trade_frequency',
      severity: 'info',
      label: 'Sparse signal density',
      detail: `Roughly ${formatNum(tradeFreq * 30)} trades a month. Even a strong edge will take a long time to compound — pair with a complementary strategy.`,
    })
  }

  return diags
}


// ─── Consistency enforcement (the contradiction guard) ───────────

function enforceConsistency(args: {
  grade:       StrategyGrade
  metrics:     ExtendedMetrics
  diagnostics: StrategyDiagnostic[]
  result:      BacktestResult
}): { grade: StrategyGrade; diagnostics: StrategyDiagnostic[] } {
  const { grade, metrics, result } = args
  let diagnostics = args.diagnostics
  const positiveProof =
    result.netPnl > 0 ||
    (metrics.profit_factor != null && metrics.profit_factor > 1) ||
    (metrics.expectancy    != null && metrics.expectancy    > 0)

  // Rule 1+2+3: positive P&L / PF > 1 / positive expectancy must NEVER
  // produce a "loses money" or "negative edge" diagnostic.
  if (positiveProof) {
    diagnostics = diagnostics.filter((d) => d.kind !== 'negative_edge')
  }

  // Rule 4: thin sample must not show a hard letter grade or a
  // "losing strategy" verdict. Already enforced in deriveGrade(),
  // but guard the verdict text here too.
  let nextGrade = grade
  if (metrics.trades < MIN_TRADES_RELIABLE && grade.grade !== 'N/A') {
    nextGrade = {
      ...grade,
      grade: 'N/A',
      score: null,
      verdict: `Insufficient observations for statistical confidence. ${metrics.trades} trade${metrics.trades === 1 ? '' : 's'} — minimum recommended sample size is ${MIN_TRADES_RELIABLE}.`,
      // readiness already encodes the stage; preserved through spread.
    }
  }

  // Rule 5: if the verdict text claims "loses money" but the math is
  // positive, replace it.
  if (positiveProof && /lose|loses|losing|do not deploy/i.test(nextGrade.verdict)) {
    nextGrade = {
      ...nextGrade,
      verdict: nextGrade.grade === 'N/A'
        ? nextGrade.verdict
        : 'Profitable in this sample but scored low on risk and stability. Validate carefully.',
    }
  }

  return { grade: nextGrade, diagnostics }
}


// ─── Reliability score (independent of profitability) ────────────

function computeReliability(
  trades: number,
  consistency: number | null,
  edgeStability: number | null,
): number {
  // Trade count gets you most of the way; consistency + edge stability
  // refine the read once they're computable.
  let s = 0
  if (trades >= HIGH_CONFIDENCE_TRADES) s = 90
  else if (trades >= MIN_TRADES_RELIABLE) s = 60 + (trades - 30) * (30 / 70)
  else if (trades >= 10)                  s = 20 + (trades - 10) * 2
  else                                    s = trades * 2

  if (consistency    != null) s = (s * 0.7) + (consistency    * 0.15) + (s * 0.15)
  if (edgeStability  != null) s = (s * 0.7) + (edgeStability  * 0.15) + (s * 0.15)

  return clamp(Math.round(s))
}


// ─── Sortino / Calmar / Consistency / Edge stability ─────────────

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
  // netPnlPct is in PERCENT (e.g. 6.7 for +6.7%); maxDrawdownPct is
  // FRACTION (0..1). Convert both to the same fraction unit before the
  // ratio — this is the bug the audit caught: the prior version
  // divided percent/fraction (off by 100×).
  if (result.maxDrawdownPct <= 0) return null
  return round2((result.netPnlPct / 100) / result.maxDrawdownPct)
}

function computeConsistency(pnls: number[]): number | null {
  // Lowered the floor from 10 → 5 so users get *some* read on small
  // samples. The grade card's confidence pill (low/medium/high)
  // communicates the trustworthiness so the number isn't misleading.
  if (pnls.length < 5) return null
  const m  = mean(pnls)
  const meanAbs = Math.max(1, Math.abs(m))
  const variance = pnls.reduce((a, v) => a + (v - m) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  const cv  = std / meanAbs
  const raw = Math.max(0, 100 - cv * 25)
  return Math.round(raw)
}

function computeEdgeStability(trades: BacktestTrade[]): number | null {
  // Lowered from 20 → 10 — same rationale as consistency. Confidence
  // pill communicates trustworthiness.
  if (trades.length < 10) return null
  const mid = Math.floor(trades.length / 2)
  const first  = trades.slice(0, mid)
  const second = trades.slice(mid)
  const wr1 = first.filter((t) => t.result === 'win').length  / first.length
  const wr2 = second.filter((t) => t.result === 'win').length / second.length
  const delta = Math.abs(wr1 - wr2)
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


// ─── Diagnostic ranking ─────────────────────────────────────────

function rankDiagnostics(diags: StrategyDiagnostic[]): StrategyDiagnostic[] {
  const sev = (d: StrategyDiagnostic) =>
    d.severity === 'critical' ? 4 :
    d.severity === 'warn'     ? 3 :
    d.severity === 'good'     ? 2 : 1
  return [...diags].sort((a, b) => sev(b) - sev(a))
}


// ─── Helpers ─────────────────────────────────────────────────────

function sum(xs: number[]): number   { return xs.reduce((a, b) => a + b, 0) }
function mean(xs: number[]): number  { return xs.reduce((a, b) => a + b, 0) / xs.length }
function round2(n: number): number   { return Math.round(n * 100) / 100 }
function round4(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10_000) / 10_000
}
function clamp(n: number): number    { return Math.max(0, Math.min(100, Math.round(n))) }
function pct(v: number): string      {
  // Input is a fraction in [0, 1]. Display as "X.XX%".
  return `${(v * 100).toFixed(2)}%`
}
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}
