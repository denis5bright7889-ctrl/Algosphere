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
  Brain, Activity, BarChart3, ShieldCheck, TrendingUp,
  AlertOctagon, CheckCircle2, Info, BookOpen, Sparkles, Zap,
  Calendar, Radar, Target, MinusCircle, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn, formatRelativeTime } from '@/lib/utils'
import { analyzeBehavior, type BehavioralReport } from '@/lib/intelligence/behavioral'
import { analyzePerformance, type PerformanceReport, type SegmentRow } from '@/lib/intelligence/performance'
import { generateInsights, type CoachInsight } from '@/lib/intelligence/coach'
import { generateTiming, type RegimeSnapshot, type TimingRecommendation, type TimingReport } from '@/lib/intelligence/timing'
import {
  lossDrivers, conditionEdges,
  type LossDriversReport, type ConditionCohort,
  type V2Entry,
} from '@/lib/intelligence/journal-analytics'
import type { JournalEntry } from '@/lib/types'

interface CoachEvalRow {
  id:                string
  journal_entry_id:  string
  quality_score:     number
  strategy_grade:    'A' | 'B' | 'C' | 'D' | 'F'
  emotional_flag:    boolean
  emotional_reason:  string | null
  what_worked:       string[]
  what_to_fix:       string[]
  advancement:       string | null
  created_at:        string
  /** Joined journal context */
  pair:              string | null
  direction:         string | null
  pnl:               number | null
}

export const metadata = { title: 'Trader Intelligence — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30

export default async function TraderIntelligencePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const [entriesRes, evalsRes, snapshotsRes, brokersRes] = await Promise.all([
    supabase.from('journal_entries')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500),
    // R4b: latest 8 deterministic coach evaluations, joined with the
    // journal entry's pair/direction/pnl for context-rich rendering.
    supabase.from('journal_coach_evaluations')
      .select(`
        id, journal_entry_id, quality_score, strategy_grade,
        emotional_flag, emotional_reason, what_worked, what_to_fix,
        advancement, created_at,
        journal_entries!inner(pair, direction, pnl)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8),
    // R4b: latest regime per symbol for the timing panel. RLS-public
    // table (read by every authenticated user).
    supabase.from('regime_snapshots')
      .select('symbol, regime, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(120),
    supabase.from('broker_connections')
      .select('equity_usd')
      .eq('user_id', user.id),
  ])

  const entries = (entriesRes.data ?? []) as unknown as JournalEntry[]

  if (entries.length === 0) {
    return <EmptyState />
  }

  // Flatten the joined coach-eval rows (Supabase returns the join under
  // the table name, which TS doesn't know about; cast carefully).
  type RawEval = Omit<CoachEvalRow, 'pair' | 'direction' | 'pnl'> & {
    journal_entries?: { pair: string | null; direction: string | null; pnl: number | null } | null
  }
  const evals: CoachEvalRow[] = ((evalsRes.data ?? []) as unknown as RawEval[]).map((row) => ({
    id:                row.id,
    journal_entry_id:  row.journal_entry_id,
    quality_score:     row.quality_score,
    strategy_grade:    row.strategy_grade,
    emotional_flag:    row.emotional_flag,
    emotional_reason:  row.emotional_reason,
    what_worked:       row.what_worked ?? [],
    what_to_fix:       row.what_to_fix ?? [],
    advancement:       row.advancement,
    created_at:        row.created_at,
    pair:              row.journal_entries?.pair      ?? null,
    direction:         row.journal_entries?.direction ?? null,
    pnl:               row.journal_entries?.pnl       ?? null,
  }))

  // Anchor drawdown % to real account equity (highest connected broker).
  const accountEquity = ((brokersRes.data ?? []) as { equity_usd: number | null }[])
    .map((b) => b.equity_usd)
    .filter((e): e is number => typeof e === 'number' && e > 0)
    .reduce<number | undefined>((max, e) => Math.max(max ?? 0, e), undefined)
  const behavior   = analyzeBehavior(entries, WINDOW_DAYS, accountEquity)
  const performance = analyzePerformance(entries, accountEquity)
  const insights   = generateInsights(behavior, performance, entries)
  const timing     = generateTiming(
    (snapshotsRes.data ?? []) as RegimeSnapshot[],
    performance.by_pair,
  )

  // ── Journal Intelligence (Stage 1) ──────────────────────────────────
  // Deterministic, schema-agnostic computations over V2 journal fields.
  // No LLM call, no quota cost, no schema change — every number is read
  // directly from the user's own entries.
  const v2entries  = entries as unknown as V2Entry[]
  const losses     = lossDrivers(v2entries)
  const conditions = conditionEdges(v2entries)

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

      {/* ── Market timing (R4b) ──────────────────────────────────── */}
      <section className="surface mb-5 p-5">
        <MarketTimingPanel timing={timing} />
      </section>

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

      {/* ── Recent per-trade coach evaluations (R4b) ─────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader icon={ShieldCheck} title="Recent trade evaluations" subtitle="Deterministic · runs on every trade" />
        {evals.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Coach evaluations start landing on your next logged trade — the journal write path runs the evaluator automatically.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {evals.map((e) => <EvalCard key={e.id} e={e} />)}
          </ul>
        )}
      </section>

      {/* ── Behavior panel ───────────────────────────────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader icon={Sparkles} title="Behavior" subtitle="How discipline is holding up" />
        <BehaviorPanel b={behavior} />
      </section>

      {/* ── Loss Drivers (Journal Intelligence S1) ───────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader
          icon={AlertOctagon}
          title="Loss drivers"
          subtitle={
            losses.reliable
              ? `${losses.total_losses} losing trades · ${fmtCurrency(losses.total_net_loss_usd)} net`
              : 'Why your losing trades lose'
          }
        />
        <LossDriversPanel r={losses} />
      </section>

      {/* ── Best / Worst Conditions ──────────────────────────────── */}
      <section className="grid gap-4 mb-5 sm:grid-cols-2">
        <ConditionsPanel
          title="Best conditions"
          icon={Target}
          tone="good"
          cohorts={conditions.best}
          reliable={conditions.reliable}
          insufficientReason={conditions.insufficient_reason}
          emptyHint="No positive-expectancy cohort yet."
        />
        <ConditionsPanel
          title="Worst conditions"
          icon={MinusCircle}
          tone="bad"
          cohorts={conditions.worst}
          reliable={conditions.reliable}
          insufficientReason={conditions.insufficient_reason}
          emptyHint="No negative-expectancy cohort yet."
        />
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


function TimingCard({ r }: { r: TimingRecommendation }) {
  const tone =
    r.verdict === 'favorable' ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200'
    : r.verdict === 'avoid'    ? 'border-rose-500/40 bg-rose-500/[0.04] text-rose-200'
    : 'border-amber-500/40 bg-amber-500/[0.04] text-amber-200'
  const Icon =
    r.verdict === 'favorable' ? Target
    : r.verdict === 'avoid'    ? MinusCircle
    : Info
  const label =
    r.verdict === 'favorable' ? 'Trade'
    : r.verdict === 'avoid'    ? 'Skip'
    : 'Wait'

  return (
    <li className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm font-semibold">{r.symbol}</span>
            <span className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {label}
            </span>
            {r.regime && (
              <span className="text-[10px] uppercase tracking-wider opacity-70">{r.regime}</span>
            )}
            {r.scanned_at && (
              <span
                className="ml-auto text-[10px] tabular-nums opacity-60"
                title={new Date(r.scanned_at).toLocaleString()}
              >
                scanned {formatRelativeTime(r.scanned_at)}
              </span>
            )}
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] opacity-90">
            {r.reasons.slice(0, 2).map((reason, i) => (
              <li key={i}>· {reason}</li>
            ))}
          </ul>
          {r.user_trades > 0 && (
            <p className="mt-1 font-mono text-[10px] tabular-nums opacity-60">
              {r.user_trades} trades · WR {r.user_win_rate != null ? `${Math.round(r.user_win_rate * 100)}%` : '—'} · E {r.user_expectancy != null ? r.user_expectancy.toFixed(2) : '—'}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}


/** Market Timing panel — split the recommendations into two reads:
 *  - "Actionable" cards: anywhere the user has trade history OR the
 *    verdict is decisive (favorable / avoid). These are the trade
 *    decisions for today.
 *  - "Available regimes": engine-only data on pairs the user hasn't
 *    journaled. Rendered as a compact chip strip so a 34-pair scan
 *    universe doesn't dump 34 "Wait" cards on the user. */
function MarketTimingPanel({ timing }: { timing: TimingReport }) {
  const recos     = timing.recommendations
  const decisive  = recos.filter((r) => r.verdict !== 'caution' || r.user_trades > 0)
  const regimeOnly = recos.filter((r) => r.verdict === 'caution' && r.user_trades === 0)
  const latestScan = recos
    .map((r) => r.scanned_at)
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1)

  return (
    <>
      <SectionHeader
        icon={Radar}
        title="Market timing"
        subtitle={
          latestScan
            ? `Live regime × your edge · scanned ${formatRelativeTime(latestScan)}`
            : `Live regime × your edge · ${recos.length} pair${recos.length === 1 ? '' : 's'}`
        }
      />
      <p className="mt-1 text-[12px] text-foreground/85">{timing.headline}</p>

      {decisive.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {decisive.slice(0, 6).map((r) => (
            <TimingCard key={r.symbol} r={r} />
          ))}
        </ul>
      )}

      {regimeOnly.length > 0 && (
        <div className="mt-4 rounded-lg border border-border/40 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Available regimes ({regimeOnly.length})
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              No edge data yet — log trades on these pairs to enable timing.
            </span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {regimeOnly.map((r) => (
              <li key={r.symbol}>
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px]"
                  title={r.scanned_at ? `${r.regime ?? '—'} · scanned ${new Date(r.scanned_at).toLocaleString()}` : (r.regime ?? '—')}
                >
                  <span className="font-mono font-semibold">{r.symbol}</span>
                  {r.regime && <span className="text-muted-foreground/80">· {r.regime}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decisive.length === 0 && regimeOnly.length === 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          No regime scans available yet. The engine publishes regimes on its scan cadence — refresh in a minute.
        </p>
      )}
    </>
  )
}


function EvalCard({ e }: { e: CoachEvalRow }) {
  const gradeTone =
    e.strategy_grade === 'A' ? 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10'
    : e.strategy_grade === 'B' ? 'text-blue-300 border-blue-500/40 bg-blue-500/10'
    : e.strategy_grade === 'C' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
    : e.strategy_grade === 'D' ? 'text-orange-300 border-orange-500/40 bg-orange-500/10'
    : 'text-rose-300 border-rose-500/50 bg-rose-500/10'

  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-start gap-3">
        <span className={cn(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-base font-bold',
          gradeTone,
        )}>
          {e.strategy_grade}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            {e.pair && <span className="font-mono text-sm font-semibold">{e.pair}</span>}
            {e.direction && (
              <span className={cn(
                'rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                e.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
              )}>
                {e.direction}
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {e.quality_score}/100
            </span>
            {e.emotional_flag && (
              <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                <AlertOctagon className="h-2.5 w-2.5" />
                {e.emotional_reason ?? 'Emotional'}
              </span>
            )}
            {e.pnl != null && (
              <span className={cn(
                'text-[10px] font-bold tabular-nums',
                e.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300',
              )}>
                {e.pnl >= 0 ? '+' : ''}{fmtCurrency(e.pnl)}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              {new Date(e.created_at).toLocaleDateString()}
            </span>
          </div>
          {e.advancement && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/85">{e.advancement}</p>
          )}
          {(e.what_worked.length > 0 || e.what_to_fix.length > 0) && (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 text-[11px]">
              {e.what_worked.length > 0 && (
                <ul className="space-y-0.5 text-emerald-300/85">
                  {e.what_worked.slice(0, 3).map((w, i) => (
                    <li key={i} className="flex gap-1">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />{w}
                    </li>
                  ))}
                </ul>
              )}
              {e.what_to_fix.length > 0 && (
                <ul className="space-y-0.5 text-amber-300/85">
                  {e.what_to_fix.slice(0, 3).map((w, i) => (
                    <li key={i} className="flex gap-1">
                      <AlertOctagon className="mt-0.5 h-3 w-3 shrink-0" />{w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
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

// ─── Journal Intelligence (Stage 1) sub-components ──────────────────

function LossDriversPanel({ r }: { r: LossDriversReport }) {
  if (!r.reliable) {
    return (
      <p className="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2} />
        {r.insufficient_reason ?? 'Insufficient data to attribute losses.'}
      </p>
    )
  }
  const top = r.drivers.slice(0, 6)
  return (
    <ul className="mt-3 space-y-1.5">
      {top.map((d) => (
        <li key={d.category} className="flex items-center gap-3 text-[12px]">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{d.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {d.losses} {d.losses === 1 ? 'loss' : 'losses'} · {fmtCurrency(d.net_loss_usd)}
              </span>
            </div>
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-rose-300">
            {d.loss_share_pct.toFixed(0)}%
          </span>
        </li>
      ))}
    </ul>
  )
}

function ConditionsPanel({
  title, icon: Icon, tone, cohorts, reliable, insufficientReason, emptyHint,
}: {
  title:              string
  icon:               LucideIcon
  tone:               'good' | 'bad'
  cohorts:            ConditionCohort[]
  reliable:           boolean
  insufficientReason: string | undefined
  emptyHint:          string
}) {
  return (
    <div className="surface p-5">
      <SectionHeader icon={Icon} title={title} subtitle="Cohort win-rate · expectancy" />
      {!reliable ? (
        <p className="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2} />
          {insufficientReason ?? 'Insufficient data.'}
        </p>
      ) : cohorts.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {cohorts.map((c) => (
            <li key={`${c.dim}-${c.key}`} className="flex items-center gap-3 text-[12px]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{c.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {c.trades} trades
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
                  <span>{(c.win_rate * 100).toFixed(0)}% win-rate</span>
                  <span className={tone === 'good' ? 'text-emerald-300' : 'text-rose-300'}>
                    {c.expectancy >= 0 ? '+' : ''}{fmtCurrency(c.expectancy)}/trade
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
