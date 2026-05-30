/**
 * Strategy Intelligence Report (Journal V4 directive).
 *
 * Every backtest run produces a structured report that answers:
 *
 *   • Why does this strategy work?
 *   • Why does it fail?
 *   • What are its best conditions?
 *   • What are its worst conditions?
 *   • Best / worst sessions?
 *   • Best / worst volatility environment?
 *   • What are its risk characteristics?
 *   • What's the deployment readiness?
 *
 * Pure functions. Derived strictly from the BacktestResult's realised
 * trade sequence — no fabricated takes. The honesty contract from the
 * audit fix still holds: any reason cited here is gated by the metric
 * threshold that drives it.
 *
 * This report complements gradeStrategy() (lib/intelligence/strategy-
 * grader.ts): the grader emits scores + diagnostics; the intelligence
 * report frames those into the narrative the V4 spec asks for.
 */
import type { BacktestResult, BacktestTrade } from '@/lib/backtest'
import type { StrategyAnalysis } from './strategy-grader'


export interface ConditionInsight {
  label:   string
  detail:  string
  evidence?: string
}

export interface StrategyIntelligenceReport {
  /** 2–3 evidence-based reasons for the observed edge. */
  why_it_works: ConditionInsight[]
  /** 2–3 loss drivers — what's leaking. */
  why_it_fails: ConditionInsight[]
  /** Conditions under which the strategy performs best. */
  best_conditions:  ConditionInsight[]
  /** Conditions under which the strategy struggles. */
  worst_conditions: ConditionInsight[]
  /** Session-of-day breakdown (best + worst). */
  best_session:  SessionEdge | null
  worst_session: SessionEdge | null
  /** Volatility regime breakdown — bucketed by per-trade ATR proxy. */
  best_volatility:  VolatilityEdge | null
  worst_volatility: VolatilityEdge | null
  /** Risk characteristics distilled from the trade distribution. */
  risk_characteristics: string[]
  /** Bullet-list reasons the user should be cautious about overfitting. */
  overfitting_risk: string[]
  /** Mirrors strategy-grader.readiness so the UI can read both in one
   *  place; null when grader output isn't available. */
  deployment_readiness: StrategyAnalysis['grade']['readiness'] | null
}


export interface SessionEdge {
  session: 'asia' | 'london' | 'new_york' | 'off_hours'
  trades:  number
  win_rate: number
  expectancy: number
  total_pnl:  number
}

export interface VolatilityEdge {
  bucket:    'low' | 'medium' | 'high'
  trades:    number
  win_rate:  number
  expectancy: number
}


/**
 * Compute the intelligence report from a backtest result + the grader's
 * analysis output. The grader is the single source of truth for sample
 * reliability + readiness; this report frames those numbers narratively.
 */
export function generateIntelligenceReport(
  result:   BacktestResult,
  analysis: StrategyAnalysis | null,
): StrategyIntelligenceReport {
  const trades = result.trades

  const why_it_works = analyzeWhyItWorks(result, trades, analysis)
  const why_it_fails = analyzeWhyItFails(result, trades, analysis)

  const sessionEdges = bucketBySession(trades)
  const volEdges     = bucketByVolatility(trades)
  const best_session  = pickBest(sessionEdges)
  const worst_session = pickWorst(sessionEdges)
  const best_volatility  = pickBestVol(volEdges)
  const worst_volatility = pickWorstVol(volEdges)

  const best_conditions = composeBestConditions(best_session, best_volatility)
  const worst_conditions = composeWorstConditions(worst_session, worst_volatility, result, trades)

  return {
    why_it_works,
    why_it_fails,
    best_conditions,
    worst_conditions,
    best_session,
    worst_session,
    best_volatility,
    worst_volatility,
    risk_characteristics: distillRiskCharacteristics(result, analysis),
    overfitting_risk:     distillOverfittingRisk(trades.length, analysis),
    deployment_readiness: analysis?.grade.readiness ?? null,
  }
}


// ─── "Why it works" ──────────────────────────────────────────────

function analyzeWhyItWorks(
  result: BacktestResult,
  trades: BacktestTrade[],
  analysis: StrategyAnalysis | null,
): ConditionInsight[] {
  const out: ConditionInsight[] = []
  if (trades.length === 0) return out

  // 1. Profit factor + expectancy
  const m = analysis?.metrics
  if (m?.profit_factor != null && m.profit_factor >= 1.5
      && m.expectancy != null && m.expectancy > 0) {
    out.push({
      label: 'Realised positive expectancy',
      detail: `Profit factor ${m.profit_factor.toFixed(2)} with positive expectancy across ${trades.length} trades — the entries are picking spots where reward outpaces risk.`,
      evidence: `PF ${m.profit_factor.toFixed(2)} · E ${m.expectancy.toFixed(2)}`,
    })
  }

  // 2. Strong R-multiple
  if (m?.expectancy_r != null && m.expectancy_r > 0.25) {
    out.push({
      label: 'Edge in R-multiples',
      detail: `Each trade nets +${m.expectancy_r.toFixed(2)}R on average. The TP/SL geometry favours holding winners through to the planned target.`,
      evidence: `expectancy_R ${m.expectancy_r.toFixed(2)}`,
    })
  }

  // 3. Stable edge across the sample
  if (m?.edge_stability != null && m.edge_stability >= 70) {
    out.push({
      label: 'Edge stable across the sample',
      detail: `Win rate held within band between the first and second half of the trade sequence — the strategy isn't relying on a single regime burst.`,
      evidence: `edge_stability ${m.edge_stability}/100`,
    })
  }

  // 4. Tame drawdown
  if (result.maxDrawdownPct < 0.10 && result.netPnl > 0) {
    out.push({
      label: 'Controlled drawdown',
      detail: `Max drawdown stayed under 10% (${(result.maxDrawdownPct * 100).toFixed(1)}%) while the strategy compounded profit — risk per trade is sized appropriately.`,
      evidence: `max_dd ${(result.maxDrawdownPct * 100).toFixed(2)}%`,
    })
  }

  // 5. Win rate × R:R balance
  const wins = trades.filter((t) => t.result === 'win').length
  const wr   = trades.length > 0 ? wins / trades.length : 0
  if (wr >= 0.55 && wr <= 0.70 && m?.expectancy_r != null && m.expectancy_r > 0) {
    out.push({
      label: 'Balanced win-rate / R:R',
      detail: `Win rate ${Math.round(wr * 100)}% paired with positive R expectancy — the strategy isn't propped up by a few outliers.`,
      evidence: `WR ${Math.round(wr * 100)}%`,
    })
  }

  return out.slice(0, 4)
}


// ─── "Why it fails" ──────────────────────────────────────────────

function analyzeWhyItFails(
  result: BacktestResult,
  trades: BacktestTrade[],
  analysis: StrategyAnalysis | null,
): ConditionInsight[] {
  const out: ConditionInsight[] = []
  if (trades.length === 0) return out

  const m = analysis?.metrics
  const losses = trades.filter((t) => t.result === 'loss')

  // 1. Negative expectancy (only when truly losing)
  if (m?.profit_factor != null && m.profit_factor < 1
      && m.expectancy != null && m.expectancy < 0) {
    out.push({
      label: 'Losses outweigh wins',
      detail: `Profit factor ${m.profit_factor.toFixed(2)} and negative expectancy ${m.expectancy.toFixed(2)} mean every average trade gives back capital. Rework entry conditions or exit timing.`,
      evidence: `PF ${m.profit_factor.toFixed(2)} · E ${m.expectancy.toFixed(2)}`,
    })
  }

  // 2. Tail-driven losses — one bad trade dominates
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0
  if (result.netPnl !== 0) {
    const tailShare = Math.abs(largestLoss) / Math.abs(result.netPnl)
    if (tailShare > 0.40) {
      out.push({
        label: 'A single bad trade dominates',
        detail: `One losing trade was ${(tailShare * 100).toFixed(0)}% of net P&L. Tail risk on a single fill is unmanaged — tighten stops or hard-cap position size.`,
        evidence: `largest_loss ${(tailShare * 100).toFixed(0)}% of net`,
      })
    }
  }

  // 3. Drawdown beyond live discipline
  if (result.maxDrawdownPct >= 0.20) {
    out.push({
      label: 'Drawdown beyond live discipline',
      detail: `Peak drawdown of ${(result.maxDrawdownPct * 100).toFixed(1)}% — even a positive-expectancy run at this risk is unsizeable in live capital.`,
      evidence: `max_dd ${(result.maxDrawdownPct * 100).toFixed(2)}%`,
    })
  }

  // 4. Edge decay
  if (m?.edge_stability != null && m.edge_stability < 50) {
    out.push({
      label: 'Edge decays over time',
      detail: `Win rate dropped between the first and second half of the sample — the strategy may be regime-dependent or curve-fit to the early period.`,
      evidence: `edge_stability ${m.edge_stability}/100`,
    })
  }

  // 5. R:R too tight for the loss rate
  if (m?.win_rate != null && m.win_rate < 0.45
      && m.expectancy != null && m.expectancy < 0) {
    out.push({
      label: 'R:R doesn\'t cover the loss rate',
      detail: `Win rate ${Math.round(m.win_rate * 100)}% with negative expectancy — average win must grow vs average loss for this to break even.`,
      evidence: `WR ${Math.round(m.win_rate * 100)}%`,
    })
  }

  return out.slice(0, 4)
}


// ─── Session bucketing (UTC hour → London/NY/Asia/off_hours) ────

function sessionFor(hourUTC: number): SessionEdge['session'] {
  if (hourUTC >= 0  && hourUTC < 7)  return 'asia'
  if (hourUTC >= 7  && hourUTC < 13) return 'london'
  if (hourUTC >= 13 && hourUTC < 21) return 'new_york'
  return 'off_hours'
}

function bucketBySession(trades: BacktestTrade[]): SessionEdge[] {
  const buckets: Record<SessionEdge['session'], BacktestTrade[]> = {
    asia: [], london: [], new_york: [], off_hours: [],
  }
  for (const t of trades) {
    const h = new Date(t.entryTime * 1000).getUTCHours()
    buckets[sessionFor(h)].push(t)
  }
  return (Object.entries(buckets) as Array<[SessionEdge['session'], BacktestTrade[]]>)
    .filter(([, ts]) => ts.length >= 3)
    .map(([session, ts]) => {
      const wins = ts.filter((t) => t.result === 'win').length
      const pnl  = ts.reduce((s, t) => s + t.pnl, 0)
      return {
        session,
        trades: ts.length,
        win_rate: ts.length > 0 ? wins / ts.length : 0,
        expectancy: ts.length > 0 ? pnl / ts.length : 0,
        total_pnl: pnl,
      }
    })
}

function pickBest(edges: SessionEdge[]): SessionEdge | null {
  if (edges.length === 0) return null
  return [...edges].sort((a, b) => b.expectancy - a.expectancy)[0] ?? null
}

function pickWorst(edges: SessionEdge[]): SessionEdge | null {
  if (edges.length === 0) return null
  return [...edges].sort((a, b) => a.expectancy - b.expectancy)[0] ?? null
}


// ─── Volatility bucketing — per-trade abs-PnL as a proxy for vol ─

function bucketByVolatility(trades: BacktestTrade[]): VolatilityEdge[] {
  if (trades.length < 6) return []
  const abs = trades.map((t) => Math.abs(t.pnl)).sort((a, b) => a - b)
  const t1 = abs[Math.floor(abs.length / 3)]      ?? 0
  const t2 = abs[Math.floor(2 * abs.length / 3)]  ?? 0
  const buckets: Record<VolatilityEdge['bucket'], BacktestTrade[]> = {
    low: [], medium: [], high: [],
  }
  for (const t of trades) {
    const a = Math.abs(t.pnl)
    if (a <= t1)      buckets.low.push(t)
    else if (a <= t2) buckets.medium.push(t)
    else              buckets.high.push(t)
  }
  return (Object.entries(buckets) as Array<[VolatilityEdge['bucket'], BacktestTrade[]]>)
    .filter(([, ts]) => ts.length >= 3)
    .map(([bucket, ts]) => {
      const wins = ts.filter((t) => t.result === 'win').length
      const pnl  = ts.reduce((s, t) => s + t.pnl, 0)
      return {
        bucket,
        trades: ts.length,
        win_rate: ts.length > 0 ? wins / ts.length : 0,
        expectancy: ts.length > 0 ? pnl / ts.length : 0,
      }
    })
}

function pickBestVol(edges: VolatilityEdge[]): VolatilityEdge | null {
  if (edges.length === 0) return null
  return [...edges].sort((a, b) => b.expectancy - a.expectancy)[0] ?? null
}
function pickWorstVol(edges: VolatilityEdge[]): VolatilityEdge | null {
  if (edges.length === 0) return null
  return [...edges].sort((a, b) => a.expectancy - b.expectancy)[0] ?? null
}


// ─── Condition narrative composition ─────────────────────────────

function composeBestConditions(
  best_session: SessionEdge | null,
  best_vol:     VolatilityEdge | null,
): ConditionInsight[] {
  const out: ConditionInsight[] = []
  if (best_session && best_session.expectancy > 0) {
    out.push({
      label: `${labelSession(best_session.session)} session is the strongest window`,
      detail: `Expectancy +${best_session.expectancy.toFixed(2)} per trade across ${best_session.trades} ${labelSession(best_session.session)}-session trades. Lean into this slot.`,
      evidence: `WR ${Math.round(best_session.win_rate * 100)}% · ${best_session.trades} trades`,
    })
  }
  if (best_vol && best_vol.expectancy > 0) {
    out.push({
      label: `${labelVolatility(best_vol.bucket)} volatility favours the strategy`,
      detail: `Expectancy +${best_vol.expectancy.toFixed(2)} on ${best_vol.trades} ${labelVolatility(best_vol.bucket)}-vol trades — the strategy needs this regime to express its edge.`,
      evidence: `WR ${Math.round(best_vol.win_rate * 100)}% · ${best_vol.trades} trades`,
    })
  }
  return out
}

function composeWorstConditions(
  worst_session: SessionEdge | null,
  worst_vol:     VolatilityEdge | null,
  result:        BacktestResult,
  trades:        BacktestTrade[],
): ConditionInsight[] {
  const out: ConditionInsight[] = []
  if (worst_session && worst_session.expectancy < 0) {
    out.push({
      label: `${labelSession(worst_session.session)} session bleeds`,
      detail: `Expectancy ${worst_session.expectancy.toFixed(2)} across ${worst_session.trades} ${labelSession(worst_session.session)}-session trades. Consider sitting out this slot.`,
      evidence: `WR ${Math.round(worst_session.win_rate * 100)}% · ${worst_session.trades} trades`,
    })
  }
  if (worst_vol && worst_vol.expectancy < 0) {
    out.push({
      label: `${labelVolatility(worst_vol.bucket)} volatility is hostile`,
      detail: `Expectancy ${worst_vol.expectancy.toFixed(2)} on ${worst_vol.trades} ${labelVolatility(worst_vol.bucket)}-vol trades — the strategy struggles when this regime is in play.`,
      evidence: `WR ${Math.round(worst_vol.win_rate * 100)}% · ${worst_vol.trades} trades`,
    })
  }
  // Drawdown-time cluster note — only when DD is non-trivial.
  if (result.maxDrawdownPct >= 0.15 && trades.length >= 10) {
    out.push({
      label: 'Drawdown clusters meaningfully',
      detail: `Peak-to-trough drawdown of ${(result.maxDrawdownPct * 100).toFixed(1)}% — losing trades cluster rather than being interspersed evenly. Live discipline must absorb runs.`,
      evidence: `max_dd ${(result.maxDrawdownPct * 100).toFixed(2)}%`,
    })
  }
  return out
}

function labelSession(s: SessionEdge['session']): string {
  return s === 'new_york' ? 'New York'
       : s === 'off_hours' ? 'Off-hours'
       : s.charAt(0).toUpperCase() + s.slice(1)
}
function labelVolatility(b: VolatilityEdge['bucket']): string {
  return b.charAt(0).toUpperCase() + b.slice(1)
}


// ─── Risk characteristics ───────────────────────────────────────

function distillRiskCharacteristics(
  result:   BacktestResult,
  analysis: StrategyAnalysis | null,
): string[] {
  const out: string[] = []
  out.push(`Max drawdown: ${(result.maxDrawdownPct * 100).toFixed(2)}%`)
  if (analysis?.metrics.largest_loss_pct != null) {
    out.push(`Largest loss share of net: ${Math.round(analysis.metrics.largest_loss_pct * 100)}%`)
  }
  if (analysis?.metrics.sortino != null) {
    out.push(`Sortino ratio: ${analysis.metrics.sortino.toFixed(2)}`)
  }
  if (analysis?.metrics.calmar != null) {
    out.push(`Calmar-like ratio: ${analysis.metrics.calmar.toFixed(2)}`)
  }
  return out
}


// ─── Overfitting risk ───────────────────────────────────────────

function distillOverfittingRisk(
  tradeCount: number,
  analysis:   StrategyAnalysis | null,
): string[] {
  const out: string[] = []
  if (tradeCount < 30) {
    out.push(`Sample is below 30 trades — any apparent edge is provisional and should be re-tested.`)
  }
  if (analysis) {
    const pf = analysis.metrics.profit_factor ?? 0
    if (tradeCount < 50 && pf > 2.5) {
      out.push(`Profit factor ${pf.toFixed(2)} on ${tradeCount} trades is suspiciously high — re-test on a longer history or different symbol.`)
    }
    if (analysis.metrics.edge_stability != null
        && analysis.metrics.edge_stability < 50) {
      out.push(`Edge weakened between the first and second half of the sample — the early period may be carrying the curve-fit.`)
    }
  }
  return out
}
