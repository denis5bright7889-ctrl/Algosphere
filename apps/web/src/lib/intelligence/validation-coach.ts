/**
 * AI Strategy Validation Coach (v2) — Phase 7 of the Validation Center.
 *
 * Pure deterministic function over a StrategyMetrics record. Distinct
 * from `strategy-coach.ts` (which advises on BACKTEST + block configs);
 * this one reviews live VALIDATION performance and produces a
 * deployment recommendation.
 *
 * Output per strategy:
 *   • overall_grade       — A+ / A / B+ / B / C / D
 *   • readiness_score     — 0–100 weighted composite
 *   • recommendation      — approve / watchlist / reject
 *   • whats_working       — top strengths (metrics above threshold)
 *   • whats_failing       — top weaknesses (metrics below threshold)
 *   • whats_to_fix        — concrete action items from failures
 *   • risk_assessment     — narrative paragraph from real metrics
 *
 * Honesty contract:
 *   - Refuses to review any strategy with collecting_data=true
 *     (sample < STRATEGY_MIN_SAMPLE). Returns null.
 *   - Every line in whats_working / whats_failing / whats_to_fix
 *     traces to a numeric metric that was actually computed.
 *     No invented recommendations.
 *   - Recommendation alignment is mechanical:
 *       approve   iff readiness ≥ 80
 *       reject    iff readiness < 60
 *       watchlist otherwise
 *     The coach can't disagree with its own score.
 */
import type { StrategyMetrics } from './strategy-performance-aggregate'

export type ValidationCoachGrade          = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D'
export type ValidationCoachRecommendation = 'approve' | 'watchlist' | 'reject'

export interface ValidationCoachReview {
  strategy_id:      string
  strategy_name:    string
  overall_grade:    ValidationCoachGrade
  readiness_score:  number
  recommendation:   ValidationCoachRecommendation
  whats_working:    string[]
  whats_failing:    string[]
  whats_to_fix:     string[]
  risk_assessment:  string
}

interface MetricThreshold {
  metric: keyof StrategyMetrics
  label:  string
  pass:   number
  fmt:    'pct' | 'num' | 'usd'
}

const THRESHOLDS: MetricThreshold[] = [
  { metric: 'win_rate_pct',     label: 'Win rate',           pass: 55,  fmt: 'pct' },
  { metric: 'profit_factor',    label: 'Profit factor',      pass: 1.5, fmt: 'num' },
  { metric: 'sharpe',           label: 'Sharpe ratio',       pass: 1.0, fmt: 'num' },
  { metric: 'sortino',          label: 'Sortino ratio',      pass: 1.2, fmt: 'num' },
  { metric: 'expectancy',       label: 'Expectancy / trade', pass: 0,   fmt: 'usd' },
  { metric: 'recovery_factor',  label: 'Recovery factor',    pass: 1.0, fmt: 'num' },
  { metric: 'risk_score',       label: 'Risk score',         pass: 70,  fmt: 'num' },
  { metric: 'confidence_score', label: 'Confidence score',   pass: 60,  fmt: 'num' },
]

function fmt(v: number | null, kind: 'pct' | 'num' | 'usd'): string {
  if (v == null) return '—'
  if (kind === 'pct') return `${v}%`
  if (kind === 'usd') return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
  return v.toFixed(2)
}

function gradeFor(score: number): ValidationCoachGrade {
  if (score >= 95) return 'A+'
  if (score >= 90) return 'A'
  if (score >= 85) return 'B+'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  return 'D'
}

function recommendationFor(score: number): ValidationCoachRecommendation {
  if (score >= 80) return 'approve'
  if (score >= 60) return 'watchlist'
  return 'reject'
}

/**
 * Readiness score (0-100). Weighted composite:
 *   25% sample size       (50 closed trades → 100%)
 *   25% profit factor     (PF 2.0 → 100%, PF 1.0 → 0%)
 *   20% sharpe            (Sharpe 1.5 → 100%, ≤ 0 → 0%)
 *   15% drawdown control  (max_dd as % of net P&L: 0% → 100%, ≥ 30% → 0%)
 *   15% win rate          (60% → 100%, ≤ 40% → 0%)
 *
 * Each term degrades gracefully when the metric is null (treats as 0).
 */
function readinessFor(m: StrategyMetrics): number {
  const sampleTerm = Math.max(0, Math.min(1, m.closed_count / 50))
  const pfTerm     = m.profit_factor == null ? 0
                    : Math.max(0, Math.min(1, (m.profit_factor - 1) / 1))
  const sharpeTerm = m.sharpe == null ? 0
                    : Math.max(0, Math.min(1, m.sharpe / 1.5))
  const ddRatio    = m.net_pnl != null && m.max_drawdown != null
                       && (Math.abs(m.net_pnl) + Math.abs(m.max_drawdown)) > 0
                    ? Math.abs(m.max_drawdown) / Math.max(Math.abs(m.net_pnl), Math.abs(m.max_drawdown))
                    : null
  const ddTerm     = ddRatio == null ? 0 : Math.max(0, Math.min(1, 1 - ddRatio / 0.30))
  const wrTerm     = m.win_rate_pct == null ? 0
                    : Math.max(0, Math.min(1, (m.win_rate_pct - 40) / 20))

  return Math.round(
    (sampleTerm * 25) + (pfTerm * 25) + (sharpeTerm * 20)
    + (ddTerm * 15)   + (wrTerm * 15)
  )
}

function actionableFixes(m: StrategyMetrics, failing: MetricThreshold[]): string[] {
  const fixes: string[] = []
  for (const t of failing.slice(0, 3)) {
    const v = m[t.metric] as number | null
    switch (t.metric) {
      case 'win_rate_pct':
        fixes.push(`Win rate ${fmt(v, 'pct')} is below the 55% target — review setup quality on losers; consider tightening entry filters.`)
        break
      case 'profit_factor':
        fixes.push(`Profit factor ${fmt(v, 'num')} is below 1.5 — wins aren't large enough relative to losers; review TP placement or trail logic.`)
        break
      case 'sharpe':
        fixes.push(`Sharpe ${fmt(v, 'num')} is below 1.0 — return per unit of volatility is thin; consider reducing size or trade frequency.`)
        break
      case 'sortino':
        fixes.push(`Sortino ${fmt(v, 'num')} is low — downside volatility dominates; review stop-loss placement on losers.`)
        break
      case 'expectancy':
        fixes.push(`Expectancy ${fmt(v, 'usd')} is non-positive — average trade is unprofitable; no edge at this sample.`)
        break
      case 'recovery_factor':
        fixes.push(`Recovery factor ${fmt(v, 'num')} is below 1.0 — drawdowns exceed net profit; reduce max risk per trade.`)
        break
      case 'risk_score':
        fixes.push(`Risk score ${fmt(v, 'num')} is below 70 — equity-curve volatility is high; tighten daily loss cap and per-trade size.`)
        break
      case 'confidence_score':
        fixes.push(`Confidence score ${fmt(v, 'num')} is below 60 — sample, PF, or win rate hasn't built enough conviction. Continue validation.`)
        break
    }
  }
  if (fixes.length === 0) {
    fixes.push('No critical metric is failing the institutional threshold. Continue current validation cadence.')
  }
  return fixes
}

function riskNarrative(m: StrategyMetrics): string {
  const parts: string[] = []
  if (m.max_drawdown == null || m.net_pnl == null) {
    parts.push('Drawdown analysis is incomplete — fewer closed trades than the institutional threshold.')
  } else {
    const ddRatio = Math.abs(m.net_pnl) > 0
      ? Math.abs(m.max_drawdown) / Math.abs(m.net_pnl) : 1
    if (ddRatio < 0.3) {
      parts.push(`Drawdown is well-contained: max drawdown is ${(ddRatio * 100).toFixed(0)}% of net P&L.`)
    } else if (ddRatio < 0.6) {
      parts.push(`Drawdown is acceptable but watchable: ${(ddRatio * 100).toFixed(0)}% of net P&L spent in drawdown.`)
    } else {
      parts.push(`Drawdown is elevated: ${(ddRatio * 100).toFixed(0)}% of net P&L — the equity curve takes back much of what it makes.`)
    }
  }
  if (m.risk_score != null) {
    if (m.risk_score >= 70) {
      parts.push(`Composite risk score ${m.risk_score}/100 indicates a stable equity curve.`)
    } else if (m.risk_score >= 50) {
      parts.push(`Composite risk score ${m.risk_score}/100 indicates moderate volatility — size with care.`)
    } else {
      parts.push(`Composite risk score ${m.risk_score}/100 is low — high volatility relative to expectancy.`)
    }
  }
  if (m.closed_count < 30) {
    parts.push(`Sample size (${m.closed_count} closed) is below the 30-trade institutional minimum for outcome-based claims — treat all metrics as preliminary.`)
  }
  return parts.join(' ')
}

export function reviewStrategyForValidation(m: StrategyMetrics): ValidationCoachReview | null {
  if (m.collecting_data) return null

  const passing: MetricThreshold[] = []
  const failing: MetricThreshold[] = []
  for (const t of THRESHOLDS) {
    const v = m[t.metric] as number | null
    if (v == null) continue
    const passes = v >= t.pass
    if (passes) passing.push(t)
    else        failing.push(t)
  }

  const whatsWorking = passing.slice(0, 3).map(t => {
    const v = m[t.metric] as number | null
    return `${t.label} ${fmt(v, t.fmt)} — above the institutional threshold of ${fmt(t.pass, t.fmt)}.`
  })

  const whatsFailing = failing.slice(0, 3).map(t => {
    const v = m[t.metric] as number | null
    return `${t.label} ${fmt(v, t.fmt)} — below the threshold of ${fmt(t.pass, t.fmt)}.`
  })

  const readiness = readinessFor(m)
  const grade     = gradeFor(readiness)
  const rec       = recommendationFor(readiness)
  const fixes     = actionableFixes(m, failing)
  const risk      = riskNarrative(m)

  return {
    strategy_id:     m.strategy_id,
    strategy_name:   m.strategy_name,
    overall_grade:   grade,
    readiness_score: readiness,
    recommendation:  rec,
    whats_working:   whatsWorking.length > 0 ? whatsWorking
                       : ['No metrics are clearing institutional thresholds yet.'],
    whats_failing:   whatsFailing.length > 0 ? whatsFailing
                       : ['No metrics are failing the institutional thresholds.'],
    whats_to_fix:    fixes,
    risk_assessment: risk,
  }
}

export function reviewAllStrategiesForValidation(
  strategies: StrategyMetrics[],
): ValidationCoachReview[] {
  const out: ValidationCoachReview[] = []
  for (const s of strategies) {
    const r = reviewStrategyForValidation(s)
    if (r) out.push(r)
  }
  // Approve-ready first — operator sees the best candidates on top.
  out.sort((a, b) => b.readiness_score - a.readiness_score)
  return out
}
