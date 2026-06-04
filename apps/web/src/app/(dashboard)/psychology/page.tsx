/**
 * /psychology — Psychology Intelligence (Refocus V3).
 *
 * Lead with the always-on deterministic read (free, instant): revenge,
 * overtrade, calm vs FOMO mix, and the top 1–2 psychology-relevant
 * coach insights. Keep the on-demand Gemini deep-dive (PsychologyClient,
 * gated on 5 daily generations) below for the long-form narrative.
 *
 * Same engines as /intelligence/me and /risk — single source of truth
 * for behavioral analysis; this page just lenses the read through the
 * psychology axes (emotion + impulse), not the risk axes.
 */
import { redirect } from 'next/navigation'
import {
  Brain, AlertOctagon, Repeat, Smile, Flame, Info,
  CalendarOff, Zap, TrendingDown, Award, ShieldCheck,
  Activity, HeartPulse, Hourglass, Sparkles,
  TriangleAlert, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { analyzeBehavior, type BehavioralReport } from '@/lib/intelligence/behavioral'
import { analyzePerformance } from '@/lib/intelligence/performance'
import { generateInsights, type CoachInsight } from '@/lib/intelligence/coach'
import type { JournalEntry } from '@/lib/types'
import PsychologyClient from './PsychologyClient'

export const metadata = { title: 'Psychology Intelligence — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30
const PSYCH_INSIGHT_KINDS = new Set<CoachInsight['kind']>([
  'revenge', 'overtrade', 'consistency', 'discipline',
])

export default async function PsychologyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const { data: rows } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(500)

  const entries = (rows ?? []) as unknown as JournalEntry[]
  const behavior    = entries.length > 0 ? analyzeBehavior(entries, WINDOW_DAYS) : null
  const performance = entries.length > 0 ? analyzePerformance(entries)           : null
  const insights    = (behavior && performance) ? generateInsights(behavior, performance, entries) : []
  const psychInsights = insights.filter((i) => PSYCH_INSIGHT_KINDS.has(i.kind)).slice(0, 2)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          Psychology <span className="text-gradient">Intelligence</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Always-on read on revenge, overtrading, and emotional drift. Run the
          weekly Gemini deep-dive when you want the long-form narrative.
        </p>
      </header>

      <PsychologyRead behavior={behavior} insights={psychInsights} entryCount={entries.length} />

      {behavior && behavior.closed_trades >= 8 && (
        <>
          <MaturityHero behavior={behavior} />
          <InstitutionalScores behavior={behavior} />
          <CoachingPanel behavior={behavior} />
          <BehavioralRiskMatrix behavior={behavior} />
        </>
      )}

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <Brain className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">Weekly deep-dive</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">Gemini · 5 / day</span>
        </div>
        <PsychologyClient />
      </div>
    </div>
  )
}


// ─── AI Psychology Read ──────────────────────────────────────────────

interface PsychologyReadProps {
  behavior:   BehavioralReport | null
  insights:   CoachInsight[]
  entryCount: number
}

function PsychologyRead({ behavior, insights, entryCount }: PsychologyReadProps) {
  if (!behavior || entryCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">AI Psychology Read</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">Waiting on data</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Log a few trades on the <a href="/journal" className="text-amber-300 hover:underline">journal</a> — including <code className="text-foreground/70">emotion_pre</code> when you can — and the read turns on. The Gemini deep-dive below needs at least 5 trades in the last 30 days.
        </p>
      </div>
    )
  }

  // Surface calm and FOMO as positive/negative framing of the same
  // emotion_pre mix. Other emotions roll up under the deep-dive.
  const calmPct = Math.round(behavior.emotion_summary.calm * 100)
  const fomoPct = Math.round(behavior.emotion_summary.fomo * 100)
  const emotionLogged =
    behavior.emotion_summary.calm
    + behavior.emotion_summary.fomo
    + behavior.emotion_summary.fearful
    + behavior.emotion_summary.greedy
    + behavior.emotion_summary.other
  const hasEmotion = emotionLogged > 0

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">AI Psychology Read</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Last {WINDOW_DAYS} days · {behavior.closed_trades} closed
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PsychTile
          label="Revenge risk"
          icon={AlertOctagon}
          score={behavior.revenge_risk}
          higherIsBetter={false}
          hint={`${behavior.revenge_count} flagged trades`}
        />
        <PsychTile
          label="Overtrade risk"
          icon={Repeat}
          score={behavior.overtrade_risk}
          higherIsBetter={false}
          hint={`${behavior.overtrade_days} flagged days`}
        />
        <PsychTile
          label="Calm entries"
          icon={Smile}
          score={hasEmotion ? calmPct : null}
          higherIsBetter
          unit="%"
          hint={hasEmotion ? 'log emotion_pre' : 'no emotion logs'}
        />
        <PsychTile
          label="FOMO trades"
          icon={Flame}
          score={behavior.fomo_risk ?? (hasEmotion ? fomoPct : null)}
          higherIsBetter={false}
          hint={behavior.fomo_risk != null
            ? `${behavior.fomo_count} flagged`
            : (hasEmotion ? 'log emotion_pre' : 'no emotion logs')}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PsychTile
          label="Weekend gambling"
          icon={CalendarOff}
          score={behavior.weekend_gamble_risk}
          higherIsBetter={false}
          hint={`${behavior.weekend_gamble_count} weekend trades`}
        />
        <PsychTile
          label="Impulse trades"
          icon={Zap}
          score={behavior.impulse_risk}
          higherIsBetter={false}
          hint={`${behavior.impulse_count} with no setup_tag`}
        />
        <PsychTile
          label="Loss chasing"
          icon={TrendingDown}
          score={behavior.loss_chase_risk}
          higherIsBetter={false}
          hint={`${behavior.loss_chase_count} kept full risk in 3+ loss streak`}
        />
      </div>

      {insights.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {insights.map((i, idx) => (
            <PsychInsightRow key={idx} i={i} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[12px] text-muted-foreground">
          No psychology-specific patterns flagged in this window. Keep logging — patterns surface as soon as the sample supports them.
        </p>
      )}
    </div>
  )
}

function PsychTile({ label, icon: Icon, score, higherIsBetter, unit = '', hint }: {
  label: string
  icon: LucideIcon
  score: number | null
  higherIsBetter: boolean
  unit?: string
  hint?: string
}) {
  if (score == null) {
    return (
      <div className="rounded-lg border border-border/40 bg-background/40 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
        </div>
        <div className="mt-1 text-xs text-muted-foreground/70">Insufficient data</div>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{hint}</p>}
      </div>
    )
  }
  const good = higherIsBetter ? score >= 65 : score <= 25
  const bad  = higherIsBetter ? score < 35  : score >= 60
  const tone = good ? 'text-emerald-300' : bad ? 'text-rose-300' : 'text-amber-300'
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
      </div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums leading-none', tone)}>
        {score}{unit || <span className="text-[11px] opacity-50">/100</span>}
      </div>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

function PsychInsightRow({ i }: { i: CoachInsight }) {
  const tone = {
    info:     'border-border bg-card/60 text-foreground/85',
    good:     'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200',
    warn:     'border-amber-500/40 bg-amber-500/[0.06] text-amber-200',
    critical: 'border-rose-500/50 bg-rose-500/[0.06] text-rose-200',
  }[i.severity]
  const Icon = i.severity === 'info' ? Info : AlertOctagon
  return (
    <li className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug">{i.headline}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{i.detail}</p>
          {i.evidence && (
            <p className="mt-1 font-mono text-[10px] tabular-nums opacity-70">{i.evidence}</p>
          )}
        </div>
      </div>
    </li>
  )
}


// ─── V2 — Trading Maturity hero ─────────────────────────────────────

const MATURITY_TONE: Record<string, string> = {
  Beginner:   'from-rose-500/30 to-rose-500/5 text-rose-200',
  Developing: 'from-amber-500/25 to-amber-500/5 text-amber-200',
  Competent:  'from-cyan-500/25 to-cyan-500/5 text-cyan-200',
  Advanced:   'from-emerald-500/25 to-emerald-500/5 text-emerald-200',
  Elite:      'from-fuchsia-500/30 to-fuchsia-500/5 text-fuchsia-200',
}

function MaturityHero({ behavior }: { behavior: BehavioralReport }) {
  const idx   = behavior.trading_maturity_index
  const level = behavior.maturity_level
  if (idx == null || !level) return null
  const tone = MATURITY_TONE[level] ?? 'from-amber-500/20 to-amber-500/5 text-amber-200'
  return (
    <div className={cn(
      'mt-5 rounded-xl border border-border bg-gradient-to-br p-5',
      tone,
    )}>
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold tracking-wide">Trading Maturity Index</h2>
        <span className="ml-auto text-[11px] opacity-70">Last {behavior.window_days}d</span>
      </div>
      <div className="mt-3 flex items-end gap-4">
        <div className="text-5xl font-bold tabular-nums leading-none">{idx}</div>
        <div className="flex-1 pb-1">
          <div className="text-base font-semibold">{level}</div>
          {behavior.maturity_blurb && (
            <p className="mt-0.5 text-[12px] opacity-80">{behavior.maturity_blurb}</p>
          )}
        </div>
      </div>
    </div>
  )
}


// ─── V2 — Institutional 6-axis scoreboard ───────────────────────────

function InstitutionalScores({ behavior }: { behavior: BehavioralReport }) {
  const s = behavior.institutional_scores
  const TILES: Array<{ label: string; icon: LucideIcon; score: number | null; hint?: string }> = [
    { label: 'Psychology',  icon: Brain,       score: s.psychology,  hint: 'self-control composite' },
    { label: 'Discipline',  icon: ShieldCheck, score: s.discipline,  hint: 'rule adherence' },
    { label: 'Consistency', icon: Activity,    score: s.consistency, hint: 'P&L distribution' },
    { label: 'Resilience',  icon: HeartPulse,  score: s.resilience,
      hint: behavior.recovery_time_days != null
        ? `recovered in ${behavior.recovery_time_days}d`
        : 'recovery quality' },
    { label: 'Patience',    icon: Hourglass,   score: s.patience,    hint: 'selectivity' },
    { label: 'Maturity',    icon: Sparkles,    score: s.maturity,    hint: behavior.maturity_level ?? undefined },
  ]
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">Institutional Scoreboard</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">6 axes · 0–100 · higher is better</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => (
          <PsychTile key={t.label} {...t} higherIsBetter />
        ))}
      </div>
    </div>
  )
}


// ─── V2 — Deterministic coaching panel ──────────────────────────────

function CoachingPanel({ behavior }: { behavior: BehavioralReport }) {
  const c = behavior.coaching
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">AI Coach Read</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">Always-on · deterministic</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">{c.summary}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-300">
            <ShieldCheck className="h-3 w-3" strokeWidth={2} aria-hidden /> Strengths
          </div>
          {c.strengths.length > 0 ? (
            <ul className="space-y-1.5 text-[12px] text-foreground/85">
              {c.strengths.map((s, i) => (<li key={i} className="leading-snug">{s}</li>))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">No positive axis cleared 70/100 yet.</p>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-300">
            <TriangleAlert className="h-3 w-3" strokeWidth={2} aria-hidden /> Weaknesses
          </div>
          {c.weaknesses.length > 0 ? (
            <ul className="space-y-1.5 text-[12px] text-foreground/85">
              {c.weaknesses.map((s, i) => (<li key={i} className="leading-snug">{s}</li>))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">No risk metric crossed the 45/100 threshold.</p>
          )}
        </div>
      </div>

      {c.recommendations.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300">
            <Zap className="h-3 w-3" strokeWidth={2} aria-hidden /> Recommendations
          </div>
          <ol className="space-y-1.5 text-[12px] leading-relaxed text-foreground/85">
            {c.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-200">
                  {i + 1}
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}


// ─── V2 — Behavioral risk matrix (12 risk metrics + counts) ─────────

function BehavioralRiskMatrix({ behavior }: { behavior: BehavioralReport }) {
  const ROWS: Array<{ label: string; icon: LucideIcon; risk: number | null; count?: number; hint?: string }> = [
    { label: 'Revenge',          icon: AlertOctagon, risk: behavior.revenge_risk,         count: behavior.revenge_count,         hint: 'post-loss aggression' },
    { label: 'Tilt',             icon: Flame,        risk: behavior.tilt_risk,            count: behavior.tilt_events.length,    hint: '24h after large loss' },
    { label: 'FOMO',             icon: Flame,        risk: behavior.fomo_risk,            count: behavior.fomo_count,            hint: 'chase entries' },
    { label: 'Impulse',          icon: Zap,          risk: behavior.impulse_risk,         count: behavior.impulse_count,         hint: 'no setup_tag' },
    { label: 'Overtrade',        icon: Repeat,       risk: behavior.overtrade_risk,       count: behavior.overtrade_days,        hint: 'daily cap blown' },
    { label: 'Risk inflation',   icon: TrendingDown, risk: behavior.risk_inflation_risk,  count: behavior.risk_inflation_count,  hint: 'sizing up after wins' },
    { label: 'Confidence drift', icon: Sparkles,     risk: behavior.confidence_drift_risk,count: behavior.confidence_drift_count,hint: 'size + selectivity drift' },
    { label: 'Loss chasing',     icon: TrendingDown, risk: behavior.loss_chase_risk,      count: behavior.loss_chase_count,      hint: '3+ loss streak, full risk' },
    { label: 'Strategy hopping', icon: Repeat,       risk: behavior.strategy_hopping_risk,count: behavior.strategy_switch_count, hint: 'setup_tag switching' },
    { label: 'Recency bias',     icon: Activity,     risk: behavior.recency_bias_risk,    count: behavior.recency_bias_events.length, hint: 'pair-selection bias' },
    { label: 'Weekend gamble',   icon: CalendarOff,  risk: behavior.weekend_gamble_risk,  count: behavior.weekend_gamble_count,  hint: 'Sat/Sun trades' },
    { label: 'Rule violations',  icon: TriangleAlert,risk: behavior.discipline_risk,      count: behavior.rule_violations,       hint: 'self-reported' },
  ]
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 text-rose-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">Behavioral Risk Matrix</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">12 risks · higher is worse</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {ROWS.map((r) => (
          <RiskCell key={r.label} {...r} />
        ))}
      </div>
    </div>
  )
}

function RiskCell({ label, icon: Icon, risk, count, hint }: {
  label: string
  icon: LucideIcon
  risk: number | null
  count?: number
  hint?: string
}) {
  const tone =
    risk == null              ? 'border-border/30 bg-background/30 text-muted-foreground' :
    risk >= 60                ? 'border-rose-500/40 bg-rose-500/[0.05] text-rose-200' :
    risk >= 35                ? 'border-amber-500/40 bg-amber-500/[0.05] text-amber-200' :
                                'border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-200'
  return (
    <div className={cn('rounded-lg border p-2.5', tone)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-90">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums leading-none">
        {risk == null ? '—' : risk}
        <span className="text-[10px] opacity-50">/100</span>
      </div>
      <div className="mt-1 text-[10px] opacity-70">
        {count != null ? `${count} event${count === 1 ? '' : 's'}` : ''}{count != null && hint ? ' · ' : ''}{hint}
      </div>
    </div>
  )
}
