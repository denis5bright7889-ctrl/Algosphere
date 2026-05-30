'use client'
/**
 * StrategyDiagnosticsPanel — renders gradeStrategy output (v2).
 *
 * V2 acceptance: no displayed grade, diagnostic, drawdown metric, or
 * recommendation can contradict the underlying metrics. The panel
 * surfaces:
 *
 *   1. Grade card: letter (or "N/A") · score · confidence pill ·
 *      reliability · verdict line that the grader's consistency pass
 *      guarantees never contradicts the math.
 *   2. Component breakdown: Sample · Performance · Risk · Robustness
 *      as 0-100 bars so users see WHY the overall score is what it is.
 *   3. Institutional metrics tile grid (unchanged shape).
 *   4. Ranked diagnostics list with severity colors (incl. 'good' for
 *      positive-edge confirmations).
 */
import {
  AlertOctagon, CheckCircle2, Info, ShieldCheck, TrendingUp,
  Activity, Clock, Layers, Sparkles, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BacktestResult } from '@/lib/backtest'
import ProgressBar from '@/components/ui/ProgressBar'
import {
  gradeStrategy, type StrategyAnalysis, type StrategyGrade, type GradeBreakdown,
} from '@/lib/intelligence/strategy-grader'

interface Props {
  result: BacktestResult
}

export default function StrategyDiagnosticsPanel({ result }: Props) {
  const analysis = gradeStrategy(result)
  return (
    <div className="space-y-4">
      <GradeCard a={analysis} />
      <BreakdownBars breakdown={analysis.grade.breakdown} />
      <MetricsGrid m={analysis.metrics} />
      <DiagnosticsList items={analysis.diagnostics} />
    </div>
  )
}


function GradeCard({ a }: { a: StrategyAnalysis }) {
  const tone = {
    A:     'border-emerald-500/50 bg-emerald-500/[0.05] text-emerald-300',
    B:     'border-blue-500/40 bg-blue-500/[0.05] text-blue-300',
    C:     'border-amber-500/40 bg-amber-500/[0.05] text-amber-300',
    D:     'border-orange-500/40 bg-orange-500/[0.05] text-orange-300',
    F:     'border-rose-500/50 bg-rose-500/[0.05] text-rose-300',
    'N/A': 'border-border bg-card text-foreground/80',
  }[a.grade.grade]

  const confTone = {
    low:    'border-rose-500/40 bg-rose-500/10 text-rose-300',
    medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    high:   'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  }[a.grade.confidence]

  return (
    <div className={cn('rounded-2xl border p-4 flex items-center gap-4', tone)}>
      <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-current/30 text-2xl font-extrabold tracking-tight">
        {a.grade.grade}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">Strategy grade</h3>
          <span className="text-[10px] uppercase tracking-wider opacity-80 tabular-nums">
            {a.grade.score != null ? `${a.grade.score}/100` : 'no score'}
          </span>
          <span className={cn(
            'ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            confTone,
          )}>
            Confidence · {a.grade.confidence}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground/85">
            Reliability · {a.metrics.reliability}/100
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug">{a.grade.verdict}</p>
      </div>
    </div>
  )
}


function BreakdownBars({ breakdown }: { breakdown: GradeBreakdown }) {
  const rows: Array<{ label: string; weight: string; value: number | null }> = [
    { label: 'Sample quality', weight: '30%', value: breakdown.sample_quality },
    { label: 'Performance',    weight: '40%', value: breakdown.performance    },
    { label: 'Risk',           weight: '20%', value: breakdown.risk           },
    { label: 'Robustness',     weight: '10%', value: breakdown.robustness     },
  ]
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h3 className="text-sm font-semibold">Grade breakdown</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          weighted sum
        </span>
      </header>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {r.value == null ? `— ${r.weight}` : `${r.value}/100 · ${r.weight}`}
              </span>
            </div>
            <ProgressBar
              className="mt-1 bg-muted/40"
              value={r.value ?? 0}
              barClassName={
                r.value == null ? 'bg-transparent'
                : r.value >= 75  ? 'bg-emerald-400'
                : r.value >= 55  ? 'bg-amber-400'
                : r.value >= 35  ? 'bg-orange-400'
                : 'bg-rose-400'
              }
            />
          </li>
        ))}
      </ul>
    </div>
  )
}


function MetricsGrid({ m }: { m: StrategyAnalysis['metrics'] }) {
  const reliable = m.sample_reliable
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h3 className="text-sm font-semibold">Institutional metrics</h3>
        </div>
        {!reliable && (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
            <Info className="h-2.5 w-2.5" />
            Thin sample
          </span>
        )}
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Expectancy"      value={m.expectancy != null ? m.expectancy.toFixed(2) : '—'} />
        <Metric label="Expectancy (R)"  value={m.expectancy_r != null ? `${m.expectancy_r > 0 ? '+' : ''}${m.expectancy_r.toFixed(2)}` : '—'} positive={m.expectancy_r != null ? m.expectancy_r > 0 : undefined} />
        <Metric label="Sortino"         value={m.sortino != null ? m.sortino.toFixed(2) : '—'} />
        <Metric label="Calmar-like"     value={m.calmar  != null ? m.calmar.toFixed(2)  : '—'} />
        <Metric label="Consistency"     value={m.consistency != null ? `${m.consistency}/100` : '—'} hint="Steadiness of trade-to-trade P&L" />
        <Metric label="Edge stability"  value={m.edge_stability != null ? `${m.edge_stability}/100` : '—'} hint="Win rate across first vs second half" />
        <Metric label="Largest win"     value={m.largest_win_pct  != null ? `${Math.round(m.largest_win_pct  * 100)}% of net` : '—'} hint="Fat-tail share" />
        <Metric label="Largest loss"    value={m.largest_loss_pct != null ? `${Math.round(m.largest_loss_pct * 100)}% of net` : '—'} hint="Tail-risk share" />
        <Metric label="Avg trade days"  value={m.avg_trade_days != null ? m.avg_trade_days.toFixed(1) : '—'} hint="Holding window" />
        <Metric label="Trade freq / day" value={m.trade_frequency_per_day != null ? m.trade_frequency_per_day.toFixed(3) : '—'} hint="Signal density" />
      </div>
    </div>
  )
}


function Metric({ label, value, positive, hint }: {
  label: string; value: string; positive?: boolean; hint?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-0.5 text-sm font-semibold tabular-nums leading-none',
        positive === true  && 'text-emerald-300',
        positive === false && 'text-rose-300',
      )}>
        {value}
      </div>
      {hint && <p className="mt-0.5 text-[9px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}


function DiagnosticsList({ items }: { items: StrategyAnalysis['diagnostics'] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 flex items-center gap-2 text-xs text-emerald-200">
        <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        No diagnostic issues flagged on this sample.
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h3 className="text-sm font-semibold">Strategy diagnostics</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          ranked
        </span>
      </header>
      <ol className="space-y-2">
        {items.map((d, idx) => {
          const tone = {
            info:     'border-border bg-background/40 text-foreground/85',
            good:     'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-200',
            warn:     'border-amber-500/40 bg-amber-500/[0.06] text-amber-200',
            critical: 'border-rose-500/50 bg-rose-500/[0.06] text-rose-200',
          }[d.severity]
          const Icon =
            d.severity === 'info' ? Info :
            d.severity === 'good' ? CheckCircle2 :
            AlertOctagon
          const KindIcon = kindIcon(d.kind)
          return (
            <li key={idx} className={cn('rounded-lg border p-2.5', tone)}>
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <KindIcon className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
                    <p className="text-[12px] font-semibold">{d.label}</p>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">{d.detail}</p>
                  {d.evidence && (
                    <p className="mt-1 font-mono text-[10px] tabular-nums opacity-70">
                      {d.evidence}
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}


function kindIcon(kind: StrategyAnalysis['diagnostics'][number]['kind']): LucideIcon {
  switch (kind) {
    case 'thin_sample':         return Layers
    case 'positive_edge':       return CheckCircle2
    case 'negative_edge':       return AlertOctagon
    case 'overfit_risk':        return TrendingUp
    case 'unstable_edge':       return Activity
    case 'excessive_dd':        return AlertOctagon
    case 'fat_tail_dependence': return AlertOctagon
    case 'poor_rr_dist':        return Activity
    case 'low_trade_frequency': return Clock
    case 'session_dependency':  return Clock
    default:                    return Info
  }
}

// Defensive — silences "StrategyGrade not used as a type" if some tooling
// strips re-exports during dead-code elimination.
export type { StrategyGrade }
