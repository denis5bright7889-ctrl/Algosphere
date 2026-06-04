'use client'

/**
 * Psychology V3 — Performance Intelligence panel.
 *
 * Renders the V3 analytical core (built server-side by buildPsychologyV3)
 * over a longer history than the 30-day V2 read above it: behavior trend
 * chart, Trader DNA, risk forecasts, performance correlations, early
 * warnings, recovery profile, achievements, and the weekly coaching
 * report. Pure presentational — every number is already computed; this
 * file only formats. Nulls render as "—", never as a fabricated 0.
 */
import { useEffect } from 'react'
import {
  Activity, AlertTriangle, Award, Brain, Dna, Gauge, HeartPulse,
  LineChart as LineChartIcon, Sparkles, Target, TrendingUp, Trophy, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { track } from '@/lib/tracking/client'
import PsychologyTrendChart, { type TrendRow, type TrendLine } from './PsychologyTrendChart'
import type {
  PsychologyV3, Correlation, Forecast, EarlyWarning, WarningSeverity,
  TraderDNA, RecoveryProfile, AchievementResult, WeeklyCoachingReport,
} from '@/lib/intelligence/psychology-v3'

const TREND_LINES: TrendLine[] = [
  { key: 'maturity',     name: 'Maturity',     color: '#34d399' },
  { key: 'discipline',   name: 'Discipline',   color: '#fbbf24' },
  { key: 'self_control', name: 'Self-Control', color: '#60a5fa' },
  { key: 'revenge',      name: 'Revenge risk', color: '#fb7185' },
  { key: 'tilt',         name: 'Tilt risk',    color: '#fb923c' },
]

const SEEN_ACHIEVEMENTS_KEY = 'algosphere.psych.seen_achievements'

export default function PsychologyV3Panel({ v3 }: { v3: PsychologyV3 }) {
  // Analytics: detect newly-earned achievements per device (no server
  // persistence yet) by diffing against a localStorage set, and emit one
  // 'achievement_unlocked' event per genuinely new badge.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const earnedIds = v3.achievements.earned.map((a) => a.id)
    if (earnedIds.length === 0) return
    let seen: string[] = []
    try { seen = JSON.parse(window.localStorage.getItem(SEEN_ACHIEVEMENTS_KEY) ?? '[]') } catch { seen = [] }
    const fresh = earnedIds.filter((id) => !seen.includes(id))
    if (fresh.length === 0) return
    for (const id of fresh) track({ event: 'achievement_unlocked', payload: { achievement: id } })
    try { window.localStorage.setItem(SEEN_ACHIEVEMENTS_KEY, JSON.stringify([...new Set([...seen, ...earnedIds])])) } catch { /* ignore */ }
  }, [v3.achievements.earned])

  const rows: TrendRow[] = v3.timeline.points.map((p) => ({
    label:        p.label,
    maturity:     p.behavior.maturity_score,
    discipline:   p.behavior.discipline_score,
    self_control: p.behavior.self_control_score,
    revenge:      p.behavior.revenge_risk,
    tilt:         p.behavior.tilt_risk,
  }))
  // A trend chart needs ≥2 periods carrying at least one plotted metric.
  const plottable = rows.filter((r) =>
    TREND_LINES.some((l) => typeof r[l.key] === 'number'),
  )
  const showTrend = plottable.length >= 2

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">Performance Intelligence</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          V3 · {v3.window_days}-day history · {v3.granularity}
        </span>
      </div>

      {/* Behavior trend */}
      <div className="rounded-xl border border-border bg-card p-5">
        <Header icon={LineChartIcon} title="Behavior trend" subtitle={`${v3.timeline.points.length} periods · 0–100`} />
        {showTrend ? (
          <div className="mt-3">
            <PsychologyTrendChart data={rows} lines={TREND_LINES} />
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Need at least two periods with 8+ closed trades each to plot a trend. Keep logging across months.
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TraderDNACard dna={v3.dna} segment={v3.segment} />
        <RecoveryCard rec={v3.recovery} />
      </div>

      <ForecastRow forecast={v3.forecast} />

      {v3.early_warnings.length > 0 && <EarlyWarnings warnings={v3.early_warnings} />}

      {v3.correlations.length > 0 && <Correlations correlations={v3.correlations} />}

      <Achievements result={v3.achievements} />

      <CoachV2 report={v3.coaching_v2} />
    </section>
  )
}


// ─── Trader DNA ──────────────────────────────────────────────────────

function TraderDNACard({ dna, segment }: { dna: TraderDNA | null; segment: PsychologyV3['segment'] }) {
  const segTone: Record<PsychologyV3['segment'], string> = {
    low:      'text-emerald-300',
    moderate: 'text-amber-300',
    elevated: 'text-orange-300',
    high:     'text-rose-300',
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Header icon={Dna} title="Trader DNA" subtitle={dna ? `${dna.confidence}% confidence` : 'profile'} />
      {!dna ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Not enough scored axes to classify a profile yet — log more closed trades.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold text-foreground">{dna.primary_profile}</span>
            {dna.secondary_profile && (
              <span className="text-[12px] text-muted-foreground">/ {dna.secondary_profile}</span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/85">{dna.explanation}</p>
          <div className="mt-3 space-y-1.5">
            {(Object.entries(dna.axes) as Array<[string, number | null]>).map(([axis, v]) => (
              <div key={axis} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {axis.replace(/_/g, ' ')}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  {v != null && (
                    <div
                      className="h-full rounded-full bg-gradient-primary"
                      // eslint-disable-next-line react/forbid-dom-props
                      style={{ width: `${v}%` }}
                    />
                  )}
                </div>
                <span className="w-7 shrink-0 text-right text-[11px] tabular-nums">{v ?? '—'}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px]">
            <span className="text-muted-foreground">Risk segment: </span>
            <span className={cn('font-semibold uppercase tracking-wider', segTone[segment])}>{segment}</span>
          </p>
        </>
      )}
    </div>
  )
}


// ─── Recovery ────────────────────────────────────────────────────────

function RecoveryCard({ rec }: { rec: RecoveryProfile }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Header icon={HeartPulse} title="Recovery engine" subtitle={`${rec.episodes} drawdown episode${rec.episodes === 1 ? '' : 's'}`} />
      {rec.recovery_score == null ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Recovery scoring needs 8+ closed trades with a real drawdown-and-recover sequence.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-3">
            <div className={cn('text-4xl font-bold tabular-nums leading-none', scoreTone(rec.recovery_score, true))}>
              {rec.recovery_score}<span className="text-[12px] opacity-50">/100</span>
            </div>
            <p className="pb-1 text-[11px] text-muted-foreground">composite recovery score</p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat label="Speed" value={rec.recovery_speed_trades != null ? `${rec.recovery_speed_trades} trades` : '—'} hint="to reclaim high" />
            <MiniStat label="Emotional" value={rec.emotional_stabilization != null ? `${rec.emotional_stabilization}` : '—'} hint="calm post-loss" />
            <MiniStat label="Execution" value={rec.execution_normalization != null ? `${rec.execution_normalization}` : '—'} hint="risk normalized" />
          </div>
        </>
      )}
    </div>
  )
}


// ─── Forecast ────────────────────────────────────────────────────────

function ForecastRow({ forecast }: { forecast: PsychologyV3['forecast'] }) {
  const cards: Array<[string, Forecast | null, LucideIcon]> = [
    ['Revenge trading',   forecast.revenge_forecast,    AlertTriangle],
    ['Rule violation',    forecast.discipline_forecast, TriangleAlert],
    ['Overtrade / risk',  forecast.risk_forecast,       Gauge],
  ]
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <Header icon={TrendingUp} title="Risk forecast" subtitle="next-period probability" />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map(([label, f, Icon]) => (
          <div key={label} className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
            </div>
            {f == null ? (
              <div className="mt-1 text-xs text-muted-foreground/70">Need 3+ periods</div>
            ) : (
              <>
                <div className={cn('mt-0.5 text-2xl font-semibold tabular-nums leading-none', scoreTone(f.probability, false))}>
                  {f.probability}<span className="text-[11px] opacity-50">%</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground/80">
                  {f.trend === 'rising' ? '▲ rising' : f.trend === 'falling' ? '▼ easing' : '▬ flat'} · {f.basis_periods} periods
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}


// ─── Early warnings ──────────────────────────────────────────────────

const SEV_TONE: Record<WarningSeverity, string> = {
  LOW:      'border-border bg-card/60 text-foreground/85',
  MEDIUM:   'border-amber-500/40 bg-amber-500/[0.06] text-amber-200',
  HIGH:     'border-orange-500/50 bg-orange-500/[0.06] text-orange-200',
  CRITICAL: 'border-rose-500/50 bg-rose-500/[0.07] text-rose-200',
}

function EarlyWarnings({ warnings }: { warnings: EarlyWarning[] }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <Header icon={AlertTriangle} title="Early warning system" subtitle={`${warnings.length} signal${warnings.length === 1 ? '' : 's'}`} />
      <ul className="mt-3 space-y-2">
        {warnings.map((w, i) => (
          <li key={i} className={cn('flex items-start gap-2 rounded-lg border p-3', SEV_TONE[w.severity])}>
            <span className="mt-0.5 rounded border border-current/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              {w.severity}
            </span>
            <span className="text-[12px] leading-snug">{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}


// ─── Correlations ────────────────────────────────────────────────────

function Correlations({ correlations }: { correlations: Correlation[] }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <Header icon={Activity} title="Performance correlations" subtitle="behavior ↔ profitability · ranked" />
      <ul className="mt-3 space-y-2">
        {correlations.slice(0, 6).map((c) => {
          const strong = Math.abs(c.correlation_strength)
          const tone = c.direction === 'positive' ? 'text-emerald-300' : 'text-rose-300'
          return (
            <li key={`${c.behavior}-${c.performance}`} className="rounded-lg border border-border/50 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold">{c.label}</span>
                <span className={cn('font-mono text-[12px] tabular-nums', tone)}>
                  r={c.correlation_strength >= 0 ? '+' : ''}{c.correlation_strength}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', c.direction === 'positive' ? 'bg-emerald-500' : 'bg-rose-500')}
                    // eslint-disable-next-line react/forbid-dom-props
                    style={{ width: `${Math.round(strong * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {c.confidence}% conf · n={c.sample_size}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.interpretation}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}


// ─── Achievements ────────────────────────────────────────────────────

function Achievements({ result }: { result: AchievementResult }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h3 className="text-sm font-semibold">Achievements</h3>
        <a href="/psychology/leaderboard" className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:underline">
          <Trophy className="h-3 w-3" strokeWidth={2} aria-hidden /> Rankings
        </a>
      </div>
      {result.earned.length === 0 && result.upcoming.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">No achievements tracked yet.</p>
      ) : (
        <>
          {result.earned.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.earned.map((a) => (
                <span
                  key={a.id}
                  title={a.description}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200"
                >
                  <Award className="h-3 w-3" strokeWidth={2} aria-hidden />{a.name}
                </span>
              ))}
            </div>
          )}
          {result.upcoming.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In progress</p>
              {result.upcoming.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate text-[11px]" title={a.description}>{a.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-primary"
                      // eslint-disable-next-line react/forbid-dom-props
                      style={{ width: `${Math.round(a.progress * 100)}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                    {Math.round(a.progress * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}


// ─── Coach V2 ────────────────────────────────────────────────────────

function CoachV2({ report }: { report: WeeklyCoachingReport }) {
  const lists: Array<[string, string[], string]> = [
    ['Strengths',            report.strengths,             'text-emerald-300'],
    ['Weaknesses',           report.weaknesses,            'text-rose-300'],
    ['Growth opportunities', report.growth_opportunities,  'text-cyan-300'],
    ['Risk warnings',        report.risk_warnings,         'text-orange-300'],
    ['Next-week objectives', report.next_week_objectives,  'text-amber-300'],
    ['Suggested focus',      report.suggested_focus_areas, 'text-fuchsia-300'],
  ]
  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.03] p-5">
      <Header icon={Brain} title="Weekly coaching report" subtitle={`for ${report.generated_for}`} />
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">{report.summary}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {lists.filter(([, items]) => items.length > 0).map(([title, items, tone]) => (
          <div key={title}>
            <div className={cn('mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider', tone)}>
              <Target className="h-3 w-3" strokeWidth={2} aria-hidden />{title}
            </div>
            <ul className="space-y-1 text-[12px] leading-snug text-foreground/85">
              {items.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}


// ─── Shared bits ─────────────────────────────────────────────────────

function Header({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <span className="ml-auto text-[11px] text-muted-foreground">{subtitle}</span>}
    </div>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
      {hint && <p className="mt-0.5 text-[9px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

/** `higherIsBetter` flips the tone scale (forecasts are higher=worse). */
function scoreTone(score: number, higherIsBetter: boolean): string {
  const good = higherIsBetter ? score >= 65 : score <= 25
  const bad  = higherIsBetter ? score < 35  : score >= 60
  return good ? 'text-emerald-300' : bad ? 'text-rose-300' : 'text-amber-300'
}
