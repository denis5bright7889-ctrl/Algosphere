/**
 * Psychology Engine V3 — Trader Performance Intelligence (analytical core).
 *
 * V2 (`behavioral.ts`) scores a single window: it answers "how is this
 * trader behaving right now?". V3 adds the time dimension and the
 * predictive / classification layers on top of it:
 *
 *   1.  Behavioral Timeline      — period-bucketed behavior + performance
 *   2.  Correlation Engine       — behavior ↔ profitability (Pearson)
 *   3.  Prediction Model         — trend-extrapolated risk forecasts
 *   4.  Trader DNA               — archetype classification
 *   5.  Coach V2                 — structured weekly coaching report
 *   6.  Early Warning System     — pre-emptive deterioration alerts
 *   7.  Recovery Engine          — post-loss recovery profile + score
 *   8.  Leaderboard ranking      — pure ranking/percentile logic
 *   9.  Achievements             — deterministic badge evaluation
 *   12. Data Science Layer       — k-means, segmentation, attribution
 *
 * Everything here is a PURE function of journal rows — no Supabase, no
 * I/O, no LLM, no randomness (k-means seeds deterministically). The same
 * honesty contract as V2 holds: when the sample is too thin to be honest,
 * the value is `null`, never a fabricated number. Subsystems that require
 * storage (report history), cross-user data (leaderboard fetch), PDF
 * tooling, or UI wiring live outside this module by design — the ranking
 * and award *logic* lives here so it's testable without that infra.
 */
import {
  analyzeBehavior,
  generateCoaching,
  type BehavioralReport,
  type BehaviorFlag,
} from './behavioral'

// ── Input ────────────────────────────────────────────────────────────
//
// Structurally compatible with `journal_entries` rows + the extended
// columns behavioral.ts reads. We re-feed slices straight into
// analyzeBehavior, so this stays in lock-step with V2 without coupling
// to its private JournalEntry type.

export interface V3Entry {
  created_at:      string
  pnl?:            number | null
  risk_pct?:       number | null
  lot_size?:       number | null
  pair?:           string | null
  setup_tag?:      string | null
  emotion_pre?:    string | null
  rule_violation?: boolean | null
  trade_date?:     string | null
}

export type Granularity = 'daily' | 'weekly' | 'monthly' | 'quarterly'

/** Per-period min closed trades before performance metrics are honest.
 *  (Behavior already self-gates at 8 inside analyzeBehavior.) */
const PERIOD_MIN_CLOSED = 3
/** Min populated periods before correlation / forecast are meaningful. */
const MIN_SERIES_POINTS = 3


// ─────────────────────────────────────────────────────────────────────
// 1. BEHAVIORAL TIMELINE
// ─────────────────────────────────────────────────────────────────────

/** Behavior snapshot per period. Risk metrics are HIGHER = WORSE;
 *  `*_score` metrics are HIGHER = BETTER. null = sample too thin. */
export interface PeriodBehavior {
  revenge_risk:          number | null
  discipline_score:      number | null   // = rule_adherence_score (positive)
  discipline_risk:       number | null   // rule-violation rate (negative)
  patience_score:        number | null
  consistency_score:     number | null
  maturity_score:        number | null   // = trading_maturity_index
  self_control_score:    number | null
  risk_discipline_score: number | null
  resilience_score:      number | null
  fomo_risk:             number | null
  tilt_risk:             number | null
  risk_inflation_risk:   number | null
  impulse_risk:          number | null
  overtrade_risk:        number | null
}

export interface PeriodPerformance {
  net_pnl:       number
  win_rate:      number | null
  profit_factor: number | null
  expectancy:    number | null
  sharpe:        number | null   // per-trade mean/std
  max_drawdown:  number | null   // 0–1 normalized peak-to-trough
}

export interface TimelinePoint {
  period:    string   // canonical key (e.g. 2026-03, 2026-W12, 2026-Q1)
  label:     string
  start:     string   // ISO of earliest trade in the bucket
  end:       string   // ISO of latest trade in the bucket
  trades:    number
  closed:    number
  behavior:  PeriodBehavior
  performance: PeriodPerformance
}

export interface BehavioralTimeline {
  granularity: Granularity
  points:      TimelinePoint[]
}

const BEHAVIOR_KEYS = [
  'revenge_risk', 'discipline_score', 'discipline_risk', 'patience_score',
  'consistency_score', 'maturity_score', 'self_control_score',
  'risk_discipline_score', 'resilience_score', 'fomo_risk', 'tilt_risk',
  'risk_inflation_risk', 'impulse_risk', 'overtrade_risk',
] as const
export type BehaviorKey = typeof BEHAVIOR_KEYS[number]

const PERFORMANCE_KEYS = [
  'net_pnl', 'win_rate', 'profit_factor', 'expectancy', 'sharpe', 'max_drawdown',
] as const
export type PerformanceKey = typeof PERFORMANCE_KEYS[number]

/**
 * Bucket journal rows by calendar period and compute, for each bucket,
 * the full V2 behavioral report + a performance summary. Buckets are
 * returned oldest → newest so series read left-to-right in time.
 */
export function buildBehavioralTimeline(
  entries: V3Entry[],
  granularity: Granularity = 'monthly',
): BehavioralTimeline {
  const buckets = new Map<string, V3Entry[]>()
  for (const e of entries) {
    const key = periodKey(new Date(e.created_at), granularity)
    const arr = buckets.get(key)
    if (arr) arr.push(e)
    else buckets.set(key, [e])
  }

  const points: TimelinePoint[] = []
  for (const [key, rows] of buckets) {
    const sorted = [...rows].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    const first = sorted[0]!
    const last  = sorted[sorted.length - 1]!
    const spanDays = Math.max(1, Math.ceil((+new Date(last.created_at) - +new Date(first.created_at)) / 86_400_000) + 1)

    const report = analyzeBehavior(sorted as never, spanDays)
    points.push({
      period: key,
      label:  periodLabel(key, granularity),
      start:  first.created_at,
      end:    last.created_at,
      trades: sorted.length,
      closed: sorted.filter((r) => r.pnl != null).length,
      behavior: extractBehavior(report),
      performance: periodPerformance(sorted),
    })
  }

  points.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  return { granularity, points }
}

function extractBehavior(r: BehavioralReport): PeriodBehavior {
  return {
    revenge_risk:          r.revenge_risk,
    discipline_score:      r.rule_adherence_score,
    discipline_risk:       r.discipline_risk,
    patience_score:        r.patience_score,
    consistency_score:     r.consistency_score,
    maturity_score:        r.trading_maturity_index,
    self_control_score:    r.self_control_score,
    risk_discipline_score: r.risk_discipline_score,
    resilience_score:      r.resilience_score,
    fomo_risk:             r.fomo_risk,
    tilt_risk:             r.tilt_risk,
    risk_inflation_risk:   r.risk_inflation_risk,
    impulse_risk:          r.impulse_risk,
    overtrade_risk:        r.overtrade_risk,
  }
}

function periodPerformance(rows: V3Entry[]): PeriodPerformance {
  const closed = rows.filter((r) => r.pnl != null).map((r) => r.pnl as number)
  const net = closed.reduce((a, b) => a + b, 0)
  if (closed.length < PERIOD_MIN_CLOSED) {
    return { net_pnl: net, win_rate: null, profit_factor: null, expectancy: null, sharpe: null, max_drawdown: null }
  }
  const wins   = closed.filter((p) => p > 0)
  const losses = closed.filter((p) => p < 0)
  const grossWin  = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const m   = net / closed.length
  const std = Math.sqrt(closed.reduce((a, v) => a + (v - m) ** 2, 0) / closed.length)

  // Max drawdown over the within-period equity curve.
  let eq = 0, peak = 0, maxDd = 0
  for (const p of closed) {
    eq += p
    if (eq > peak) peak = eq
    const dd = peak > 0 ? (peak - eq) / peak : 0
    if (dd > maxDd) maxDd = dd
  }

  return {
    net_pnl:       round2(net),
    win_rate:      closed.length > 0 ? round3(wins.length / closed.length) : null,
    profit_factor: grossLoss > 0 ? round2(grossWin / grossLoss) : null,
    expectancy:    round2(m),
    sharpe:        std > 0 ? round2(m / std) : null,
    max_drawdown:  round3(maxDd),
  }
}

/** Extract a single behavior metric as a time-ordered series. */
export function behaviorSeries(t: BehavioralTimeline, key: BehaviorKey): (number | null)[] {
  return t.points.map((p) => p.behavior[key])
}
/** Extract a single performance metric as a time-ordered series. */
export function performanceSeries(t: BehavioralTimeline, key: PerformanceKey): (number | null)[] {
  return t.points.map((p) => p.performance[key])
}


// ─────────────────────────────────────────────────────────────────────
// 2. PERFORMANCE CORRELATION ENGINE
// ─────────────────────────────────────────────────────────────────────

export interface Correlation {
  behavior:           BehaviorKey
  performance:        PerformanceKey
  label:              string
  correlation_strength: number   // Pearson r, [-1, 1]
  direction:          'positive' | 'negative'
  confidence:         number     // 0–100 heuristic (grows with |r| and n)
  sample_size:        number
  /** |r| × confidence/100 — used to rank predictors. */
  predictive_power:   number
  interpretation:     string
}

/** Curated, interpretable behavior↔performance pairs the engine scores.
 *  Order is cosmetic — output is ranked by predictive_power. */
const CORRELATION_PAIRS: Array<[BehaviorKey, PerformanceKey, string]> = [
  ['fomo_risk',           'profit_factor', 'FOMO vs Profit Factor'],
  ['discipline_score',    'win_rate',      'Discipline vs Win Rate'],
  ['patience_score',      'expectancy',    'Patience vs Expectancy'],
  ['tilt_risk',           'max_drawdown',  'Tilt vs Drawdown'],
  ['self_control_score',  'sharpe',        'Self-Control vs Sharpe'],
  ['risk_inflation_risk', 'profit_factor', 'Risk Inflation vs Profit Factor'],
  ['consistency_score',   'sharpe',        'Consistency vs Sharpe'],
  ['maturity_score',      'net_pnl',       'Maturity vs Net P&L'],
  ['impulse_risk',        'win_rate',      'Impulse vs Win Rate'],
  ['overtrade_risk',      'expectancy',    'Overtrading vs Expectancy'],
]

/**
 * Compute behavior↔profitability correlations across timeline periods,
 * ranked strongest-predictor first. A pair is reported only when ≥3
 * periods carry both values — otherwise it's silently dropped (never a
 * fabricated r from 2 points).
 */
export function computeCorrelations(timeline: BehavioralTimeline): Correlation[] {
  const out: Correlation[] = []
  for (const [bKey, pKey, label] of CORRELATION_PAIRS) {
    const xs: number[] = []
    const ys: number[] = []
    for (const pt of timeline.points) {
      const x = pt.behavior[bKey]
      const y = pt.performance[pKey]
      if (x == null || y == null) continue
      xs.push(x); ys.push(y)
    }
    if (xs.length < MIN_SERIES_POINTS) continue
    const r = pearson(xs, ys)
    if (r == null) continue
    const confidence = correlationConfidence(r, xs.length)
    out.push({
      behavior:   bKey,
      performance: pKey,
      label,
      correlation_strength: round2(r),
      direction:  r >= 0 ? 'positive' : 'negative',
      confidence,
      sample_size: xs.length,
      predictive_power: round2(Math.abs(r) * confidence / 100),
      interpretation: interpretCorrelation(bKey, pKey, r),
    })
  }
  return out.sort((a, b) => b.predictive_power - a.predictive_power)
}

/** Heuristic confidence (NOT a p-value): scales with |r| and is shrunk
 *  toward 0 for small samples via n/(n+4). Deterministic and monotonic. */
function correlationConfidence(r: number, n: number): number {
  const shrink = n / (n + 4)
  return clamp01_100(Math.round(Math.abs(r) * 100 * shrink))
}

function interpretCorrelation(b: BehaviorKey, p: PerformanceKey, r: number): string {
  const strong = Math.abs(r) >= 0.6 ? 'strong' : Math.abs(r) >= 0.35 ? 'moderate' : 'weak'
  const dir = r >= 0 ? 'rises with' : 'falls as'
  return `${strong} link — ${PRETTY[b]} ${dir} ${PRETTY_PERF[p]} (r=${round2(r)}).`
}


// ─────────────────────────────────────────────────────────────────────
// 3. BEHAVIORAL PREDICTION MODEL
// ─────────────────────────────────────────────────────────────────────

export interface Forecast {
  metric:      string
  probability: number   // 0–100
  trend:       'rising' | 'falling' | 'flat'
  slope:       number    // per-period change in the underlying risk metric
  basis_periods: number
}

export interface ForecastSet {
  revenge_forecast:    Forecast | null
  discipline_forecast: Forecast | null   // probability of a rule violation
  risk_forecast:       Forecast | null   // probability of overtrading / risk inflation
}

/** Project the next-period value of each risk metric and map it to a
 *  0–100 probability. Requires ≥3 populated periods; null otherwise. */
export function forecastBehavior(timeline: BehavioralTimeline): ForecastSet {
  return {
    revenge_forecast:    forecastMetric('Revenge trading', behaviorSeries(timeline, 'revenge_risk')),
    discipline_forecast: forecastMetric('Rule violation',  behaviorSeries(timeline, 'discipline_risk')),
    risk_forecast:       forecastMetric('Overtrading / risk inflation', blendSeries(
      behaviorSeries(timeline, 'overtrade_risk'),
      behaviorSeries(timeline, 'risk_inflation_risk'),
    )),
  }
}

function forecastMetric(metric: string, series: (number | null)[]): Forecast | null {
  const pts = series
    .map((v, i) => (v == null ? null : { x: i, y: v }))
    .filter((p): p is { x: number; y: number } => p != null)
  if (pts.length < MIN_SERIES_POINTS) return null

  const { slope, intercept } = linregress(pts)
  const nextX = (pts[pts.length - 1]!.x) + 1
  const projected = intercept + slope * nextX
  const probability = clamp01_100(Math.round(projected))
  const trend = slope > 1 ? 'rising' : slope < -1 ? 'falling' : 'flat'
  return { metric, probability, trend, slope: round2(slope), basis_periods: pts.length }
}


// ─────────────────────────────────────────────────────────────────────
// 4. TRADER DNA PROFILE
// ─────────────────────────────────────────────────────────────────────

export type TraderArchetype =
  | 'Disciplined Executor' | 'Aggressive Opportunist' | 'Systematic Quant'
  | 'Emotional Trader'     | 'Recovery Specialist'    | 'High Conviction Trader'

export interface TraderDNA {
  primary_profile:   TraderArchetype
  secondary_profile: TraderArchetype | null
  confidence:        number   // 0–100, derived from the nearest/2nd-nearest gap
  explanation:       string
  axes:              Record<DnaAxis, number | null>
}

const DNA_AXES = [
  'self_control', 'rule_adherence', 'risk_discipline', 'resilience', 'patience', 'consistency',
] as const
type DnaAxis = typeof DNA_AXES[number]

/** Prototype score vectors (0–100) over DNA_AXES. Hand-calibrated. */
const ARCHETYPES: Record<TraderArchetype, Record<DnaAxis, number>> = {
  'Disciplined Executor':   { self_control: 85, rule_adherence: 92, risk_discipline: 85, resilience: 75, patience: 82, consistency: 80 },
  'Systematic Quant':       { self_control: 82, rule_adherence: 85, risk_discipline: 82, resilience: 80, patience: 78, consistency: 92 },
  'Recovery Specialist':    { self_control: 72, rule_adherence: 70, risk_discipline: 66, resilience: 92, patience: 65, consistency: 62 },
  'High Conviction Trader': { self_control: 62, rule_adherence: 66, risk_discipline: 56, resilience: 72, patience: 50, consistency: 58 },
  'Aggressive Opportunist': { self_control: 45, rule_adherence: 50, risk_discipline: 40, resilience: 60, patience: 35, consistency: 45 },
  'Emotional Trader':       { self_control: 30, rule_adherence: 40, risk_discipline: 35, resilience: 42, patience: 30, consistency: 35 },
}

export function classifyTraderDNA(report: BehavioralReport): TraderDNA | null {
  const axes: Record<DnaAxis, number | null> = {
    self_control:    report.self_control_score,
    rule_adherence:  report.rule_adherence_score,
    risk_discipline: report.risk_discipline_score,
    resilience:      report.resilience_score,
    patience:        report.patience_score,
    consistency:     report.consistency_score,
  }
  const present = DNA_AXES.filter((a) => axes[a] != null)
  if (present.length < 3) return null   // not enough signal to classify honestly

  // Distance to each prototype over the present axes (normalized by count).
  const ranked = (Object.keys(ARCHETYPES) as TraderArchetype[])
    .map((name) => {
      let sumSq = 0
      for (const a of present) sumSq += ((axes[a] as number) - ARCHETYPES[name][a]) ** 2
      return { name, dist: Math.sqrt(sumSq / present.length) }
    })
    .sort((a, b) => a.dist - b.dist)

  const primary = ranked[0]!
  const second  = ranked[1]!
  // Confidence: bigger gap to the runner-up = more confident classification.
  const gap = second.dist - primary.dist
  const confidence = clamp01_100(Math.round(Math.min(100, gap * 2.2) + Math.max(0, 40 - primary.dist)))

  return {
    primary_profile:   primary.name,
    secondary_profile: gap < 6 ? second.name : null,   // genuinely ambiguous → expose the blend
    confidence,
    explanation:       explainDNA(primary.name, axes, present),
    axes,
  }
}

function explainDNA(name: TraderArchetype, axes: Record<DnaAxis, number | null>, present: DnaAxis[]): string {
  // Surface the trader's two strongest and one weakest present axis.
  const scored = present
    .map((a) => ({ a, v: axes[a] as number }))
    .sort((x, y) => y.v - x.v)
  const top = scored.slice(0, 2).map((s) => `${PRETTY_AXIS[s.a]} ${s.v}`).join(', ')
  const low = scored[scored.length - 1]
  const lowTxt = low ? ` Weakest axis: ${PRETTY_AXIS[low.a]} ${low.v}.` : ''
  return `Classified as ${name} — driven by ${top}.${lowTxt}`
}


// ─────────────────────────────────────────────────────────────────────
// 7. RECOVERY ENGINE
// ─────────────────────────────────────────────────────────────────────

export interface RecoveryProfile {
  /** Median trades to reclaim the prior equity high after a drawdown.
   *  null when no qualifying drawdown episode exists in the window. */
  recovery_speed_trades: number | null
  /** 0–100 — how calm the trader stays in the trades after a loss
   *  (emotion_pre not negative). */
  emotional_stabilization: number | null
  /** 0–100 — share of post-loss trades that keep risk ≤ baseline. */
  execution_normalization: number | null
  /** 0–100 composite recovery score. null when sample too thin. */
  recovery_score: number | null
  episodes: number
}

export function computeRecoveryProfile(entries: V3Entry[]): RecoveryProfile {
  const chron = [...entries]
    .filter((r) => r.pnl != null)
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
  if (chron.length < 8) {
    return { recovery_speed_trades: null, emotional_stabilization: null, execution_normalization: null, recovery_score: null, episodes: 0 }
  }

  // Equity curve + drawdown episodes (peak → trough → reclaim).
  let eq = 0, peak = 0, peakIdx = -1
  let inDrawdown = false
  const recoveryLengths: number[] = []
  let troughIdx = -1
  for (let i = 0; i < chron.length; i++) {
    eq += chron[i]!.pnl as number
    if (eq >= peak) {
      if (inDrawdown && troughIdx >= 0) {
        recoveryLengths.push(i - troughIdx)   // trades from trough back to high
        inDrawdown = false
      }
      peak = eq; peakIdx = i; troughIdx = -1
    } else {
      if (!inDrawdown) { inDrawdown = true; troughIdx = i }
      else if ((chron[i]!.pnl as number) < 0) troughIdx = i   // track deepening trough
      void peakIdx
    }
  }
  const recoverySpeed = recoveryLengths.length > 0 ? median(recoveryLengths) : null

  // Post-loss behavior: the trade immediately after each losing trade.
  const baselineRisk = mean(chron.map((r) => r.risk_pct ?? null).filter((x): x is number => x != null))
  let postLoss = 0, calm = 0, normalized = 0
  for (let i = 0; i < chron.length - 1; i++) {
    if ((chron[i]!.pnl as number) >= 0) continue
    const next = chron[i + 1]!
    postLoss++
    const emo = (next.emotion_pre ?? '').toLowerCase()
    const negative = emo.includes('angry') || emo.includes('frustrat') || emo.includes('tilt') ||
                     emo.includes('revenge') || emo.includes('fomo') || emo.includes('rush') || emo.includes('fear')
    if (!negative) calm++
    if (next.risk_pct == null || baselineRisk == null || next.risk_pct <= baselineRisk * 1.05) normalized++
  }

  const emotional   = postLoss >= PERIOD_MIN_CLOSED ? clamp01_100(Math.round((calm / postLoss) * 100)) : null
  const execution   = postLoss >= PERIOD_MIN_CLOSED ? clamp01_100(Math.round((normalized / postLoss) * 100)) : null
  // Speed → score: 1 trade to recover = 100, decays toward 0 by ~12 trades.
  const speedScore  = recoverySpeed != null ? clamp01_100(Math.round(100 - (recoverySpeed - 1) * 9)) : null

  const recoveryScore = compositeScore([
    [speedScore, 0.4], [emotional, 0.3], [execution, 0.3],
  ])

  return {
    recovery_speed_trades:   recoverySpeed != null ? round2(recoverySpeed) : null,
    emotional_stabilization: emotional,
    execution_normalization: execution,
    recovery_score:          recoveryScore,
    episodes:                recoveryLengths.length,
  }
}


// ─────────────────────────────────────────────────────────────────────
// 6. EARLY WARNING SYSTEM
// ─────────────────────────────────────────────────────────────────────

export type WarningSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface EarlyWarning {
  kind:     string
  metric:   BehaviorKey
  severity: WarningSeverity
  delta:    number    // change over the compared periods (risk points)
  message:  string
}

/** Risk metrics whose RISE is a deterioration signal, with a label. */
const WATCHED_RISKS: Array<[BehaviorKey, string]> = [
  ['risk_inflation_risk', 'Risk inflation trend'],
  ['tilt_risk',           'Increasing tilt probability'],
  ['discipline_risk',     'Discipline decay'],
  ['revenge_risk',        'Rising revenge-trade risk'],
  ['fomo_risk',           'Rising FOMO pressure'],
  ['overtrade_risk',      'Overtrading trend'],
]

/**
 * Compare the last two populated periods of each watched risk metric;
 * a meaningful rise (or an elevated forecast probability) becomes a
 * severity-graded warning. Emitted before the behavior fully breaks down.
 */
export function computeEarlyWarnings(timeline: BehavioralTimeline, forecast: ForecastSet): EarlyWarning[] {
  const out: EarlyWarning[] = []
  for (const [key, kind] of WATCHED_RISKS) {
    const series = behaviorSeries(timeline, key).filter((v): v is number => v != null)
    if (series.length < 2) continue
    const prev = series[series.length - 2]!
    const curr = series[series.length - 1]!
    const delta = curr - prev
    if (delta < 8 && curr < 50) continue   // not rising and not already elevated

    const severity = warningSeverity(curr, delta)
    if (severity === 'LOW' && delta < 8) continue
    out.push({
      kind, metric: key, severity, delta: Math.round(delta),
      message: `${kind}: now ${Math.round(curr)}/100 (${delta >= 0 ? '+' : ''}${Math.round(delta)} vs prior period).`,
    })
  }

  // Forecast-driven warnings (probability of a future event), independent
  // of whether the historical delta crossed the bar.
  for (const f of [forecast.revenge_forecast, forecast.discipline_forecast, forecast.risk_forecast]) {
    if (!f || f.probability < 55 || f.trend !== 'rising') continue
    out.push({
      kind: `Forecast: ${f.metric}`,
      metric: 'maturity_score',   // forecast is cross-metric; tag generically
      severity: f.probability >= 80 ? 'CRITICAL' : f.probability >= 68 ? 'HIGH' : 'MEDIUM',
      delta: Math.round(f.slope),
      message: `${f.metric} forecast at ${f.probability}% next period and rising. Pre-empt it now.`,
    })
  }

  return out.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
}

function warningSeverity(level: number, delta: number): WarningSeverity {
  const heat = level + Math.max(0, delta)
  if (heat >= 95 || level >= 80) return 'CRITICAL'
  if (heat >= 75 || level >= 62) return 'HIGH'
  if (heat >= 55 || delta >= 15) return 'MEDIUM'
  return 'LOW'
}
function severityWeight(s: WarningSeverity): number {
  return s === 'CRITICAL' ? 4 : s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : 1
}


// ─────────────────────────────────────────────────────────────────────
// 5. AI PERFORMANCE COACH V2 (weekly structured report)
// ─────────────────────────────────────────────────────────────────────

export interface WeeklyCoachingReport {
  generated_for:        string   // period label the report covers
  summary:              string
  strengths:            string[]
  weaknesses:           string[]
  growth_opportunities: string[]
  risk_warnings:        string[]
  next_week_objectives: string[]
  suggested_focus_areas: string[]
}

/**
 * Compose a structured weekly coaching report from the V3 intelligence.
 * Deterministic — reuses the V2 narrative for strengths/weaknesses and
 * layers timeline deltas, the strongest correlation, the forecast, and
 * the DNA profile into forward-looking objectives.
 */
export function generateWeeklyCoachingReport(
  current: BehavioralReport,
  timeline: BehavioralTimeline,
  correlations: Correlation[],
  forecast: ForecastSet,
  dna: TraderDNA | null,
  warnings: EarlyWarning[],
): WeeklyCoachingReport {
  const base = current.coaching.summary ? current.coaching : generateCoaching(current)
  const periodLabelTxt = timeline.points[timeline.points.length - 1]?.label ?? 'latest window'

  const growth = correlations.slice(0, 2).map((c) => {
    const lever = c.direction === 'positive'
      ? `lean into ${PRETTY[c.behavior]} — it tracks ${PRETTY_PERF[c.performance]} (r=${c.correlation_strength}).`
      : `cut ${PRETTY[c.behavior]} — it drags ${PRETTY_PERF[c.performance]} (r=${c.correlation_strength}).`
    return `Highest-leverage edge: ${lever}`
  })

  const objectives: string[] = []
  if (forecast.revenge_forecast?.trend === 'rising')
    objectives.push(`Hold revenge risk under ${Math.max(20, forecast.revenge_forecast.probability - 15)}% — enforce the post-loss cool-off.`)
  if (forecast.risk_forecast?.trend === 'rising')
    objectives.push('Freeze position size at baseline this week; the risk-inflation trend is pointing up.')
  // Always give at least one concrete objective from the worst current axis.
  objectives.push(...base.recommendations.slice(0, 2))

  const focus: string[] = []
  if (dna) focus.push(`Trade to your ${dna.primary_profile} strengths; shore up the weakest DNA axis.`)
  const trend = maturityTrend(timeline)
  if (trend) focus.push(trend)

  return {
    generated_for:        periodLabelTxt,
    summary:              base.summary,
    strengths:            base.strengths,
    weaknesses:           base.weaknesses,
    growth_opportunities: growth.length ? growth : ['Log more periods to surface behavior↔P&L correlations.'],
    risk_warnings:        warnings.slice(0, 4).map((w) => `[${w.severity}] ${w.message}`),
    next_week_objectives: dedupe(objectives).slice(0, 4),
    suggested_focus_areas: dedupe(focus),
  }
}

function maturityTrend(t: BehavioralTimeline): string | null {
  const s = behaviorSeries(t, 'maturity_score').filter((v): v is number => v != null)
  if (s.length < 2) return null
  const delta = s[s.length - 1]! - s[0]!
  if (Math.abs(delta) < 4) return 'Maturity index is holding steady — protect the routine that got you here.'
  return delta > 0
    ? `Maturity index up ${Math.round(delta)} pts across the window — the process is compounding.`
    : `Maturity index down ${Math.round(Math.abs(delta))} pts — review what changed since the start of the window.`
}


// ─────────────────────────────────────────────────────────────────────
// 9. ACHIEVEMENT SYSTEM (deterministic evaluation)
// ─────────────────────────────────────────────────────────────────────

export interface Achievement {
  id:          string
  name:        string
  description: string
  earned:      boolean
  progress:    number   // 0–1 toward earning it
}

export interface AchievementResult {
  earned:   Achievement[]
  upcoming: Achievement[]   // not yet earned, sorted by progress desc
}

/** Each badge is a pure predicate + progress fn over the V3 inputs.
 *  Progress is null-safe: a thin sample yields 0 progress, never earned. */
export function evaluateAchievements(
  report: BehavioralReport,
  recovery: RecoveryProfile,
): AchievementResult {
  const defs: Array<Omit<Achievement, 'earned' | 'progress'> & { value: number | null; target: number }> = [
    { id: 'disciplined_30',  name: '30 Days Disciplined', description: 'Rule adherence ≥ 80 across a 30-day window.',
      value: report.window_days >= 30 ? report.rule_adherence_score : null, target: 80 },
    { id: 'tilt_resistant',  name: 'Tilt Resistant', description: 'Keep tilt risk ≤ 12 with a real sample.',
      value: report.tilt_risk == null ? null : 100 - report.tilt_risk, target: 88 },
    { id: 'elite_patience',  name: 'Elite Patience', description: 'Patience score ≥ 85.',
      value: report.patience_score, target: 85 },
    { id: 'consistency_master', name: 'Consistency Master', description: 'Consistency score ≥ 80.',
      value: report.consistency_score, target: 80 },
    { id: 'risk_guardian',   name: 'Risk Guardian', description: 'Risk discipline ≥ 85.',
      value: report.risk_discipline_score, target: 85 },
    { id: 'comeback_kid',    name: 'Comeback Kid', description: 'Recovery score ≥ 80.',
      value: recovery.recovery_score, target: 80 },
  ]

  const all: Achievement[] = defs.map((d) => {
    const progress = d.value == null ? 0 : clamp01(d.value / d.target)
    return { id: d.id, name: d.name, description: d.description, earned: d.value != null && d.value >= d.target, progress: round2(progress) }
  })

  return {
    earned:   all.filter((a) => a.earned),
    upcoming: all.filter((a) => !a.earned).sort((a, b) => b.progress - a.progress),
  }
}


// ─────────────────────────────────────────────────────────────────────
// 8. LEADERBOARD RANKING (pure logic — cross-user fetch lives in infra)
// ─────────────────────────────────────────────────────────────────────

export type LeaderboardMetric =
  | 'discipline' | 'consistency' | 'patience' | 'self_control' | 'maturity'

export interface LeaderboardEntryInput {
  user_id: string
  report:  BehavioralReport
}
export interface LeaderboardRow {
  user_id:    string
  rank:        number
  value:       number
  percentile:  number   // 0–100, higher = better placement
}

const LEADERBOARD_FIELD: Record<LeaderboardMetric, (r: BehavioralReport) => number | null> = {
  discipline:   (r) => r.rule_adherence_score,
  consistency:  (r) => r.consistency_score,
  patience:     (r) => r.patience_score,
  self_control: (r) => r.self_control_score,
  maturity:     (r) => r.trading_maturity_index,
}

/** Rank users by a metric (desc). Null-scored users are excluded (they
 *  haven't earned a placement). Ties share the lower rank number. */
export function buildLeaderboard(inputs: LeaderboardEntryInput[], metric: LeaderboardMetric): LeaderboardRow[] {
  const field = LEADERBOARD_FIELD[metric]
  const scored = inputs
    .map((i) => ({ user_id: i.user_id, value: field(i.report) }))
    .filter((x): x is { user_id: string; value: number } => x.value != null)
    .sort((a, b) => b.value - a.value)

  const n = scored.length
  const rows: LeaderboardRow[] = []
  for (let i = 0; i < n; i++) {
    const cur = scored[i]!
    // Standard competition ranking (1,2,2,4).
    const rank = i > 0 && scored[i - 1]!.value === cur.value ? rows[i - 1]!.rank : i + 1
    rows.push({
      user_id: cur.user_id,
      rank,
      value: cur.value,
      percentile: n > 1 ? round1(((n - rank) / (n - 1)) * 100) : 100,
    })
  }
  return rows
}


// ─────────────────────────────────────────────────────────────────────
// 12. DATA SCIENCE LAYER
// ─────────────────────────────────────────────────────────────────────

export type RiskSegment = 'low' | 'moderate' | 'elevated' | 'high'

/** Coarse risk segmentation from the composite risk surface. */
export function segmentRisk(report: BehavioralReport): RiskSegment {
  const risks = [
    report.revenge_risk, report.tilt_risk, report.fomo_risk, report.impulse_risk,
    report.risk_inflation_risk, report.loss_chase_risk, report.discipline_risk,
  ].filter((x): x is number => x != null)
  if (risks.length === 0) return 'low'
  const avg = risks.reduce((a, b) => a + b, 0) / risks.length
  return avg >= 60 ? 'high' : avg >= 40 ? 'elevated' : avg >= 22 ? 'moderate' : 'low'
}

export interface ClusterResult {
  k:          number
  assignments: number[]            // cluster index per input vector
  centroids:  number[][]
  iterations: number
}

/**
 * Deterministic k-means over numeric feature vectors. Seeds centroids
 * with k evenly-spaced points (no RNG) so the same input always yields
 * the same clustering — required for reproducible analytics. Vectors
 * must be equal length; rows with non-finite values are rejected.
 */
export function kmeans(vectors: number[][], k: number, maxIter = 50): ClusterResult | null {
  const data = vectors.filter((v) => v.length > 0 && v.every(Number.isFinite))
  if (data.length === 0 || k < 1 || k > data.length) return null
  const dim = data[0]!.length
  if (!data.every((v) => v.length === dim)) return null

  // Deterministic seeding: evenly-spaced picks across the (stable) input order.
  let centroids: number[][] = []
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i * data.length) / k)
    centroids.push([...data[idx]!])
  }

  let assignments = new Array(data.length).fill(0)
  let iterations = 0
  for (; iterations < maxIter; iterations++) {
    let moved = false
    for (let i = 0; i < data.length; i++) {
      let best = 0, bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = sqDist(data[i]!, centroids[c]!)
        if (d < bestD) { bestD = d; best = c }
      }
      if (assignments[i] !== best) { assignments[i] = best; moved = true }
    }
    // Recompute centroids.
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0))
    const counts = new Array(k).fill(0)
    for (let i = 0; i < data.length; i++) {
      const c = assignments[i]!
      counts[c]++
      for (let d = 0; d < dim; d++) sums[c]![d] += data[i]![d]!
    }
    centroids = centroids.map((old, c) =>
      counts[c] === 0 ? old : sums[c]!.map((s) => s / counts[c]!),
    )
    if (!moved && iterations > 0) break
  }

  return { k, assignments, centroids, iterations: iterations + 1 }
}

export interface AttributionRow {
  behavior:   BehaviorKey
  impact:     number    // signed contribution proxy, [-100, 100]
  basis:      string    // which performance metric it was attributed through
}

/**
 * Performance attribution: rank which behaviors most plausibly moved P&L,
 * using the correlation engine's strength × confidence against P&L-linked
 * performance metrics. Sign reflects whether the behavior helped or hurt.
 */
export function performanceAttribution(correlations: Correlation[]): AttributionRow[] {
  const PNL_LINKED: PerformanceKey[] = ['profit_factor', 'expectancy', 'net_pnl', 'sharpe', 'win_rate']
  const rows = correlations
    .filter((c) => PNL_LINKED.includes(c.performance))
    .map((c) => {
      const isRisk = c.behavior.endsWith('_risk')
      // For a risk metric, a positive correlation with profit is counter-
      // intuitive → treat the behavior's helpfulness as the negative of r.
      const helpful = isRisk ? -c.correlation_strength : c.correlation_strength
      return { behavior: c.behavior, impact: round1(helpful * c.confidence), basis: PRETTY_PERF[c.performance] }
    })
  // Keep the strongest |impact| per behavior.
  const best = new Map<BehaviorKey, AttributionRow>()
  for (const r of rows) {
    const cur = best.get(r.behavior)
    if (!cur || Math.abs(r.impact) > Math.abs(cur.impact)) best.set(r.behavior, r)
  }
  return [...best.values()].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
}


// ─────────────────────────────────────────────────────────────────────
// TOP-LEVEL ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────

export interface PsychologyV3 {
  generated_at: string
  window_days:  number
  granularity:  Granularity
  current:      BehavioralReport
  timeline:     BehavioralTimeline
  correlations: Correlation[]
  forecast:     ForecastSet
  dna:          TraderDNA | null
  recovery:     RecoveryProfile
  early_warnings: EarlyWarning[]
  coaching_v2:  WeeklyCoachingReport
  achievements: AchievementResult
  attribution:  AttributionRow[]
  segment:      RiskSegment
}

export interface BuildV3Options {
  windowDays?:  number
  granularity?: Granularity
  now?:         Date
}

/**
 * One call → the complete V3 intelligence object for a trader's journal.
 * `entries` should already be scoped to the analysis window by the caller.
 */
export function buildPsychologyV3(entries: V3Entry[], opts: BuildV3Options = {}): PsychologyV3 {
  const windowDays  = opts.windowDays ?? 30
  const granularity = opts.granularity ?? 'monthly'
  const now = opts.now ?? new Date()

  const current      = analyzeBehavior(entries as never, windowDays)
  const timeline     = buildBehavioralTimeline(entries, granularity)
  const correlations = computeCorrelations(timeline)
  const forecast     = forecastBehavior(timeline)
  const dna          = classifyTraderDNA(current)
  const recovery     = computeRecoveryProfile(entries)
  const warnings     = computeEarlyWarnings(timeline, forecast)
  const coaching     = generateWeeklyCoachingReport(current, timeline, correlations, forecast, dna, warnings)
  const achievements = evaluateAchievements(current, recovery)
  const attribution  = performanceAttribution(correlations)

  return {
    generated_at: now.toISOString(),
    window_days:  windowDays,
    granularity,
    current,
    timeline,
    correlations,
    forecast,
    dna,
    recovery,
    early_warnings: warnings,
    coaching_v2:  coaching,
    achievements,
    attribution,
    segment:      segmentRisk(current),
  }
}


// ─────────────────────────────────────────────────────────────────────
// Period helpers
// ─────────────────────────────────────────────────────────────────────

export function periodKey(d: Date, g: Granularity): string {
  const y = d.getUTCFullYear()
  switch (g) {
    case 'daily':     return d.toISOString().slice(0, 10)
    case 'weekly':    return isoWeekKey(d)
    case 'monthly':   return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    case 'quarterly': return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
  }
}

function periodLabel(key: string, g: Granularity): string {
  if (g === 'monthly') {
    const [y, m] = key.split('-')
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${names[Number(m) - 1] ?? m} ${y}`
  }
  return key
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7        // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3)  // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}


// ─────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2 || ys.length !== n) return null
  const mx = mean(xs)!, my = mean(ys)!
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my
    num += a * b; dx += a * a; dy += b * b
  }
  const den = Math.sqrt(dx * dy)
  if (den === 0) return null   // a constant series has no linear correlation
  return clamp(num / den, -1, 1)
}

function linregress(pts: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = pts.length
  const mx = pts.reduce((a, p) => a + p.x, 0) / n
  const my = pts.reduce((a, p) => a + p.y, 0) / n
  let num = 0, den = 0
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: my - slope * mx }
}

/** Element-wise mean of two series (treating null as absent). */
function blendSeries(a: (number | null)[], b: (number | null)[]): (number | null)[] {
  const len = Math.max(a.length, b.length)
  const out: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    const xs = [a[i], b[i]].filter((v): v is number => v != null)
    out.push(xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
  }
  return out
}

/** Weighted composite over [value, weight] pairs; weights renormalize
 *  over the non-null subset. null only if every input is null. */
function compositeScore(pairs: [number | null, number][]): number | null {
  let sum = 0, w = 0
  for (const [v, weight] of pairs) {
    if (v == null) continue
    sum += v * weight; w += weight
  }
  return w === 0 ? null : clamp01_100(Math.round(sum / w))
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
function sqDist(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2
  return s
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
function clamp01(x: number): number {
  return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x
}
function clamp01_100(x: number): number {
  return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 100 ? 100 : Math.round(x)
}
function round1(x: number): number { return Math.round(x * 10) / 10 }
function round2(x: number): number { return Math.round(x * 100) / 100 }
function round3(x: number): number { return Math.round(x * 1000) / 1000 }

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter((s) => s && s.length > 0))]
}


// ─────────────────────────────────────────────────────────────────────
// Pretty-print maps (for narrative output)
// ─────────────────────────────────────────────────────────────────────

const PRETTY: Record<BehaviorKey, string> = {
  revenge_risk: 'revenge risk', discipline_score: 'discipline', discipline_risk: 'rule-violation rate',
  patience_score: 'patience', consistency_score: 'consistency', maturity_score: 'maturity',
  self_control_score: 'self-control', risk_discipline_score: 'risk discipline', resilience_score: 'resilience',
  fomo_risk: 'FOMO', tilt_risk: 'tilt', risk_inflation_risk: 'risk inflation',
  impulse_risk: 'impulse trading', overtrade_risk: 'overtrading',
}
const PRETTY_PERF: Record<PerformanceKey, string> = {
  net_pnl: 'net P&L', win_rate: 'win rate', profit_factor: 'profit factor',
  expectancy: 'expectancy', sharpe: 'Sharpe', max_drawdown: 'drawdown',
}
const PRETTY_AXIS: Record<DnaAxis, string> = {
  self_control: 'Self-Control', rule_adherence: 'Rule Adherence', risk_discipline: 'Risk Discipline',
  resilience: 'Resilience', patience: 'Patience', consistency: 'Consistency',
}
