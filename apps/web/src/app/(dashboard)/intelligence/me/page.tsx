/**
 * /intelligence/me — Trader Intelligence Dashboard (Refocus R4).
 *
 * The centerpiece of the platform refocus. Reads the user's journal
 * entries over the last 30 days, computes behavioral + performance
 * reports server-side, and feeds the deterministic coach to surface
 * ranked plain-English insights.
 *
 * Pure read pass — no writes, no LLM call, no execution dependency.
 * The existing /psychology page handles the optional generative second
 * pass with Gemini; this page grounds the conversation in real numbers.
 *
 * Honesty contract:
 *   - Every number is computed from `journal_entries` rows owned by
 *     the caller (RLS-scoped).
 *   - Segments below the `reliable` threshold render as "—" or are
 *     hidden behind an "insufficient data" pill.
 *   - When the user has zero journal entries we show an onboarding
 *     card instead of fabricating a coach take.
 */
import { redirect } from 'next/navigation'
import {
  Brain, Activity, BarChart3, ShieldCheck, TrendingUp, TrendingDown,
  AlertOctagon, CheckCircle2, Info, BookOpen, Sparkles, Zap,
  Calendar, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { analyzeBehavior, type BehavioralReport } from '@/lib/intelligence/behavioral'
import { analyzePerformance, type PerformanceReport, type SegmentRow } from '@/lib/intelligence/performance'
import { generateInsights, type CoachInsight } from '@/lib/intelligence/coach'
import type { JournalEntry } from '@/lib/types'

export const metadata = { title: 'Trader Intelligence — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30

export default async function TraderIntelligencePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data: entriesRaw } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(500)

  const entries = (entriesRaw ?? []) as unknown as JournalEntry[]

  if (entries.length === 0) {
    return <EmptyState />
  }

  const behavior   = analyzeBehavior(entries, WINDOW_DAYS)
  const performance = analyzePerformance(entries)
  const insights   = generateInsights(behavior, performance)

  return (
    <div className="mx-auto max-w-6xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Trader <span className="text-gradient">Intelligence</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            AI coach analysis of your last {WINDOW_DAYS} days · {entries.length} journal
            entries · {performance.closed_trades} closed. Every number is computed from
            your own trades — no fabricated takes.
          </p>
        </div>
        <a
          href="/journal"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-300 hover:underline"
        >
          <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />
          Log a trade
        </a>
      </header>

      {/* ── Coach feed (the main read) ───────────────────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader icon={Brain} title="Coach feed" subtitle="Ranked observations from your data" />
        {insights.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No standout patterns yet. Keep logging — the coach surfaces actionable items as soon as your sample size supports it.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {insights.map((i, idx) => (
              <CoachLine key={idx} i={i} idx={idx + 1} />
            ))}
          </ol>
        )}
      </section>

      {/* ── Behavior panel ───────────────────────────────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader icon={Sparkles} title="Behavior" subtitle="How discipline is holding up" />
        <BehaviorPanel b={behavior} />
      </section>

      {/* ── Performance panel ────────────────────────────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader icon={BarChart3} title="Performance" subtitle={`Last ${WINDOW_DAYS} days · ${performance.closed_trades} closed`} />
        <PerformancePanel p={performance} />
      </section>

      {/* ── Segment edges ────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2">
        <EdgePanel title="Pair edges" rows={performance.by_pair.slice(0, 6)} icon={TrendingUp} />
        <EdgePanel title="Session edges" rows={performance.by_session.slice(0, 4)} icon={Calendar} />
        <EdgePanel title="Setup edges" rows={performance.by_setup.slice(0, 6)} icon={Zap} />
        <EdgePanel title="Day-of-week edges" rows={performance.by_dow.slice(0, 7)} icon={Activity} />
      </section>
    </div>
  )
}


// ─── Sub-components ─────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: LucideIcon; title: string; subtitle?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {subtitle && (
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      )}
    </div>
  )
}

function CoachLine({ i, idx }: { i: CoachInsight; idx: number }) {
  const tone = {
    info:     'border-border bg-card text-foreground/85',
    good:     'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200',
    warn:     'border-amber-500/40 bg-amber-500/[0.06] text-amber-200',
    critical: 'border-rose-500/50 bg-rose-500/[0.06] text-rose-200',
  }[i.severity]

  const Icon = {
    info:     Info,
    good:     CheckCircle2,
    warn:     AlertOctagon,
    critical: AlertOctagon,
  }[i.severity] as LucideIcon

  return (
    <li className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/30 text-[10px] font-bold">
          {idx}
        </span>
        <Icon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">{i.headline}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">{i.detail}</p>
          {i.evidence && (
            <p className="mt-1.5 font-mono text-[10px] tabular-nums opacity-70">
              {i.evidence}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function BehaviorPanel({ b }: { b: BehavioralReport }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ScoreTile
        label="Consistency"
        score={b.consistency_score}
        higherIsBetter
        hint="Steadiness of P&L size"
      />
      <ScoreTile
        label="Revenge risk"
        score={b.revenge_risk}
        higherIsBetter={false}
        hint={`${b.revenge_count} flagged`}
      />
      <ScoreTile
        label="Overtrade risk"
        score={b.overtrade_risk}
        higherIsBetter={false}
        hint={`${b.overtrade_days} flagged days`}
      />
      <ScoreTile
        label="Risk inflation"
        score={b.risk_inflation_risk}
        higherIsBetter={false}
        hint={`${b.risk_inflation_count} after-win bumps`}
      />
      <ScoreTile
        label="Discipline risk"
        score={b.discipline_risk}
        higherIsBetter={false}
        hint={`${b.rule_violations} rule violations`}
      />
      <EmotionTile mix={b.emotion_summary} />
    </div>
  )
}

function PerformancePanel({ p }: { p: PerformanceReport }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total P&L" value={fmtCurrency(p.total_pnl)} positive={p.total_pnl >= 0} />
      <Stat label="Win rate"   value={p.win_rate != null ? `${Math.round(p.win_rate * 100)}%` : '—'} />
      <Stat label="Profit factor" value={p.profit_factor != null ? fmtNum(p.profit_factor) : '—'} />
      <Stat label="Expectancy" value={p.expectancy != null ? fmtNum(p.expectancy) : '—'} />
      <Stat label="Avg win"    value={p.avg_win  != null ? fmtCurrency(p.avg_win)  : '—'} />
      <Stat label="Avg loss"   value={p.avg_loss != null ? fmtCurrency(p.avg_loss) : '—'} positive={p.avg_loss != null ? false : undefined} />
      <Stat label="Max DD"     value={p.max_drawdown_pct != null ? `${Math.round(p.max_drawdown_pct * 100)}%` : '—'} hint={p.max_drawdown > 0 ? fmtCurrency(-p.max_drawdown) : ''} />
      <Stat label="Best / worst" value={`${p.best_trade != null ? fmtCurrency(p.best_trade) : '—'} / ${p.worst_trade != null ? fmtCurrency(p.worst_trade) : '—'}`} />
    </div>
  )
}

function EdgePanel({ title, rows, icon: Icon }: {
  title: string; rows: SegmentRow[]; icon: LucideIcon
}) {
  return (
    <div className="surface p-4">
      <SectionHeader icon={Icon} title={title} subtitle={`${rows.length} bucket${rows.length === 1 ? '' : 's'}`} />
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Not enough data yet — add a few more trades with this dimension filled in.
        </p>
      ) : (
        <table className="mt-2 w-full text-[11px]">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1">Key</th>
              <th className="py-1 text-right">Trades</th>
              <th className="py-1 text-right">WR</th>
              <th className="py-1 text-right">Exp</th>
              <th className="py-1 text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/40">
                <td className="py-1 font-mono">{r.key}</td>
                <td className="py-1 text-right tabular-nums">{r.trades}</td>
                <td className={cn('py-1 text-right tabular-nums', r.reliable ? '' : 'text-muted-foreground/60')}>
                  {r.win_rate != null ? `${Math.round(r.win_rate * 100)}%` : '—'}
                </td>
                <td className={cn('py-1 text-right tabular-nums', !r.reliable && 'text-muted-foreground/60')}>
                  {r.expectancy != null ? fmtNum(r.expectancy) : '—'}
                </td>
                <td className={cn('py-1 text-right tabular-nums', r.total_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  {fmtCurrency(r.total_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}


function ScoreTile({ label, score, higherIsBetter, hint }: {
  label: string; score: number | null; higherIsBetter: boolean; hint?: string
}) {
  if (score == null) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/40 p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground/70">Insufficient data</div>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{hint}</p>}
      </div>
    )
  }
  // Tone the gauge by score + direction.
  const good = higherIsBetter ? score >= 65 : score <= 25
  const bad  = higherIsBetter ? score < 35  : score >= 60
  const tone = good ? 'text-emerald-300' : bad ? 'text-rose-300' : 'text-amber-300'

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-2xl font-semibold tabular-nums leading-none', tone)}>
        {score}<span className="text-[12px] opacity-50">/100</span>
      </div>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  )
}


function EmotionTile({ mix }: {
  mix: { fearful: number; greedy: number; calm: number; fomo: number; other: number }
}) {
  const total = mix.fearful + mix.greedy + mix.calm + mix.fomo + mix.other
  if (total === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/40 p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Emotion mix</div>
        <div className="mt-1 text-xs text-muted-foreground/70">
          Log <code className="text-foreground/70">emotion_pre</code> to enable.
        </div>
      </div>
    )
  }
  const rows = [
    { k: 'calm',    v: mix.calm,    tone: 'text-emerald-300' },
    { k: 'fomo',    v: mix.fomo,    tone: 'text-rose-300'    },
    { k: 'greedy',  v: mix.greedy,  tone: 'text-amber-300'   },
    { k: 'fearful', v: mix.fearful, tone: 'text-blue-300'    },
    { k: 'other',   v: mix.other,   tone: 'text-muted-foreground' },
  ]
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Emotion mix</div>
      <ul className="mt-1 space-y-0.5 text-[11px]">
        {rows.filter((r) => r.v > 0).map((r) => (
          <li key={r.k} className="flex justify-between">
            <span className={r.tone}>{r.k}</span>
            <span className="tabular-nums">{Math.round(r.v * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}


function Stat({ label, value, positive, hint }: {
  label: string; value: string; positive?: boolean; hint?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-0.5 text-base font-semibold tabular-nums leading-none',
        positive === true  && 'text-emerald-300',
        positive === false && 'text-rose-300',
      )}>
        {value}
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}


function EmptyState() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">
        Trader <span className="text-gradient">Intelligence</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The coach analyzes your last 30 days of journal entries. You haven&apos;t
        logged any yet — start with one trade and the dashboard turns on as
        soon as data lands.
      </p>
      <div className="surface mt-6 p-5">
        <SectionHeader icon={ShieldCheck} title="What the coach reads" subtitle="Read-only · scoped to you" />
        <ul className="mt-2 space-y-1.5 text-[12px] text-foreground/85">
          <li className="flex gap-2"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />Pair · session · setup performance</li>
          <li className="flex gap-2"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />Revenge / overtrade / risk-inflation flags</li>
          <li className="flex gap-2"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />Emotion-pre mix (fear / greed / calm / FOMO)</li>
          <li className="flex gap-2"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" />Consistency, drawdown, profit factor</li>
        </ul>
        <a href="/journal" className="btn-premium mt-5 inline-flex !px-4 !py-2 !text-xs">
          <BookOpen className="h-3.5 w-3.5" /> Open trade journal
        </a>
      </div>
    </div>
  )
}


function fmtCurrency(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `${sign}$${abs.toFixed(2)}`
}
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}
