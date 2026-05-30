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
  Brain, AlertOctagon, Repeat, Smile, Flame, Info, type LucideIcon,
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
          label="FOMO entries"
          icon={Flame}
          score={hasEmotion ? fomoPct : null}
          higherIsBetter={false}
          unit="%"
          hint={hasEmotion ? 'log emotion_pre' : 'no emotion logs'}
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
