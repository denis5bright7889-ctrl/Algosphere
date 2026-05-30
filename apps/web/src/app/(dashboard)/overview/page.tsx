/**
 * /overview — the AlgoSphere Command Center, intelligence-first.
 *
 * Refocus V3: the dashboard no longer leads with a chart. It leads with
 * the trader — AI Trader Score, coach lead, psychology alerts, then
 * performance, market opportunity, and broker status. The TradingView
 * workspace is demoted to a single CTA card linking to /workspace.
 *
 * Same data pipeline as /intelligence/me — reuses the deterministic
 * behavioral / performance / coach / timing engines — but renders a
 * compact "first read" summary, not the full deep-dive. Every section
 * links to its dedicated page for the long form.
 *
 * Honesty contract:
 *   - Every score is computed from `journal_entries` rows owned by the
 *     caller (RLS-scoped) over the last 30 days.
 *   - When data is insufficient (no trades, thin sample), tiles render
 *     "—" or surface an onboarding hint instead of fabricating a take.
 *   - Demo accounts (account_type='demo') keep their synthetic fallback.
 */
import { redirect } from 'next/navigation'
import {
  Brain, BarChart3, ShieldAlert, Radar, Sparkles, Target,
  AlertOctagon, CheckCircle2, Info, BookOpen, ArrowRight,
  CandlestickChart, Landmark, MinusCircle, Activity,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import { analyzeBehavior, type BehavioralReport } from '@/lib/intelligence/behavioral'
import { analyzePerformance } from '@/lib/intelligence/performance'
import { generateInsights, type CoachInsight } from '@/lib/intelligence/coach'
import { generateTiming, type RegimeSnapshot, type TimingRecommendation } from '@/lib/intelligence/timing'
import type { JournalEntry } from '@/lib/types'

export const metadata = { title: 'Command Center — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30

interface TraderScores {
  overall:     number | null
  discipline:  number | null
  consistency: number | null
  psychology:  number | null
  risk:        number | null
  timing:      number | null
}

function computeScores(b: BehavioralReport, timing: TimingRecommendation[]): TraderScores {
  // Sub-scores are 0-100 where higher = better. Behavioral risks are
  // already 0-100 where higher = worse, so we invert.
  const discipline  = b.discipline_risk     != null ? Math.max(0, 100 - b.discipline_risk)     : null
  const consistency = b.consistency_score
  const psychology  = (b.revenge_risk != null && b.overtrade_risk != null)
    ? Math.round(((100 - b.revenge_risk) + (100 - b.overtrade_risk)) / 2)
    : null
  const risk        = b.risk_inflation_risk != null ? Math.max(0, 100 - b.risk_inflation_risk) : null

  // Timing score: share of the user's regime-eligible pairs that are
  // currently 'favorable' for their edge. Null until we have at least
  // one pair with a verdict.
  let timingScore: number | null = null
  // Only count pairs the user has actually traded — timing matters
  // relative to the user's own edge, not the universe of symbols.
  const eligible = timing.filter((t) => t.user_trades > 0)
  if (eligible.length > 0) {
    const fav = eligible.filter((t) => t.verdict === 'favorable').length
    timingScore = Math.round((fav / eligible.length) * 100)
  }

  const subs = [discipline, consistency, psychology, risk, timingScore].filter(
    (n): n is number => n != null,
  )
  const overall = subs.length === 0
    ? null
    : Math.round(subs.reduce((s, n) => s + n, 0) / subs.length)

  return { overall, discipline, consistency, psychology, risk, timing: timingScore }
}

function bandTone(score: number | null): { tone: string; band: string } {
  if (score == null) return { tone: 'text-muted-foreground/70', band: '—' }
  if (score >= 75)   return { tone: 'text-emerald-300',         band: 'Strong'      }
  if (score >= 55)   return { tone: 'text-amber-300',           band: 'Steady'      }
  if (score >= 35)   return { tone: 'text-orange-300',          band: 'Inconsistent'}
  return                     { tone: 'text-rose-300',           band: 'At risk'     }
}

export default async function OverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const [
    { data: profile }, entriesRes, snapshotsRes, brokersRes,
  ] = await Promise.all([
    supabase.from('profiles').select('full_name, account_type, subscription_tier').eq('id', user.id).single(),
    supabase.from('journal_entries').select('*')
      .eq('user_id', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('regime_snapshots')
      .select('symbol, regime, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(120),
    supabase.from('broker_connections')
      .select('broker, status, is_live, equity_usd, equity_updated_at')
      .eq('user_id', user.id),
  ])

  let entries = (entriesRes.data ?? []) as unknown as JournalEntry[]

  // Demo fallback keeps the surface populated for tours.
  if (entries.length === 0 && isDemo(profile?.account_type)) {
    entries = generateDemoJournal(user.id, 25)
  }

  if (entries.length === 0) {
    return <EmptyState name={profile?.full_name ?? null} />
  }

  const behavior    = analyzeBehavior(entries, WINDOW_DAYS)
  const performance = analyzePerformance(entries)
  const insights    = generateInsights(behavior, performance)
  const timing      = generateTiming(
    (snapshotsRes.data ?? []) as RegimeSnapshot[],
    performance.by_pair,
  )
  const scores = computeScores(behavior, timing.recommendations)

  // Headline coach lead: prefer the highest-severity insight; fall back
  // to a positive read so the page never opens with a void.
  const lead = pickLead(insights)
  const alerts = insights
    .filter((i) => i.severity === 'warn' || i.severity === 'critical')
    .slice(0, 2)

  const brokers = (brokersRes.data ?? []) as Array<{
    broker: string; status: string; is_live: boolean | null;
    equity_usd: number | null; equity_updated_at: string | null;
  }>
  const connectedBrokers = brokers.filter((b) => b.status === 'connected')
  const totalEquity = connectedBrokers.reduce((s, b) => s + (b.equity_usd ?? 0), 0)

  const overallBand = bandTone(scores.overall)

  return (
    <div className="mx-auto max-w-6xl px-1 py-4 sm:px-4 sm:py-6">
      {/* ── Greeting + AI Trader Score ────────────────────────────── */}
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Command <span className="text-gradient">Center</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {profile?.full_name ? `${profile.full_name.split(' ')[0]} · ` : ''}
              Last {WINDOW_DAYS} days · {entries.length} entries · {performance.closed_trades} closed.
              Every number here is computed from your own trades.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/intelligence/me" className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-300 hover:underline">
              <Brain className="h-3.5 w-3.5" strokeWidth={2} />Open coach
            </a>
            <a href="/journal" className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-300 hover:underline">
              <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />Log trade
            </a>
          </div>
        </div>
      </header>

      {/* ── AI Trader Score (the hero) ────────────────────────────── */}
      <section className="surface mb-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">AI Trader Score</div>
            <div className={cn('mt-0.5 text-5xl font-bold tabular-nums leading-none', overallBand.tone)}>
              {scores.overall ?? '—'}
              {scores.overall != null && <span className="text-base opacity-50">/100</span>}
            </div>
            <div className={cn('mt-1 text-[11px] font-semibold uppercase tracking-wider', overallBand.tone)}>
              {overallBand.band}
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md sm:grid-cols-5">
            <SubScore label="Discipline"  score={scores.discipline} />
            <SubScore label="Consistency" score={scores.consistency} />
            <SubScore label="Psychology"  score={scores.psychology} />
            <SubScore label="Risk"        score={scores.risk} />
            <SubScore label="Timing"      score={scores.timing} />
          </div>
        </div>
      </section>

      {/* ── Top coach insight ─────────────────────────────────────── */}
      {lead && (
        <section className="surface mb-5 p-5">
          <SectionHeader icon={Brain} title="Coach lead" subtitle="Top insight from your data" cta={{ href: '/intelligence/me', label: 'Full coach' }} />
          <div className="mt-3">
            <CoachLeadCard i={lead} />
          </div>
        </section>
      )}

      {/* ── Psychology alerts (only if any) ───────────────────────── */}
      {alerts.length > 0 && (
        <section className="surface mb-5 p-5">
          <SectionHeader icon={ShieldAlert} title="Psychology alerts" subtitle={`${alerts.length} flagged this window`} cta={{ href: '/psychology', label: 'Psychology' }} />
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {alerts.map((a, i) => <AlertCard key={i} i={a} />)}
          </ul>
        </section>
      )}

      {/* ── Performance snapshot + Risk summary ───────────────────── */}
      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <SectionHeader icon={BarChart3} title="Performance" subtitle={`${performance.closed_trades} closed`} cta={{ href: '/analytics', label: 'Analytics' }} />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Net P&L"        value={fmtCurrency(performance.total_pnl)} positive={performance.total_pnl >= 0} />
            <Stat label="Win rate"       value={performance.win_rate != null ? `${Math.round(performance.win_rate * 100)}%` : '—'} />
            <Stat label="Profit factor"  value={performance.profit_factor != null ? performance.profit_factor.toFixed(2) : '—'} />
            <Stat label="Max DD"         value={performance.max_drawdown_pct != null ? `${Math.round(performance.max_drawdown_pct * 100)}%` : '—'} />
          </div>
        </div>
        <div className="surface p-5">
          <SectionHeader icon={ShieldAlert} title="Risk read" subtitle="Last 30 days" cta={{ href: '/risk', label: 'Risk engine' }} />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Risk drift"    value={behavior.risk_inflation_risk != null ? `${behavior.risk_inflation_risk}/100` : '—'} hint="lower is better" />
            <Stat label="Worst trade"   value={performance.worst_trade != null ? fmtCurrency(performance.worst_trade) : '—'} positive={performance.worst_trade != null ? performance.worst_trade >= 0 : undefined} />
            <Stat label="Avg loss"      value={performance.avg_loss != null ? fmtCurrency(performance.avg_loss) : '—'} positive={performance.avg_loss != null ? false : undefined} />
          </div>
        </div>
      </section>

      {/* ── Market opportunity radar ──────────────────────────────── */}
      <section className="surface mb-5 p-5">
        <SectionHeader icon={Radar} title="Today's opportunities" subtitle={`Live regime × your edge · ${timing.recommendations.length} pair${timing.recommendations.length === 1 ? '' : 's'}`} cta={{ href: '/intelligence', label: 'Market intel' }} />
        <p className="mt-1 text-[12px] text-foreground/85">{timing.headline}</p>
        {timing.recommendations.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {timing.recommendations.slice(0, 6).map((r) => (
              <TimingCard key={r.symbol} r={r} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Recommendations turn on once the regime engine has data for the pairs you&apos;ve traded.
          </p>
        )}
      </section>

      {/* ── Broker status + Chart workspace CTA ───────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <SectionHeader icon={Landmark} title="Broker connections" subtitle={`${connectedBrokers.length} connected`} cta={{ href: '/brokers', label: 'Manage' }} />
          {brokers.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Connect a broker (MT4 / MT5 / Binance / Bybit / OKX) so the coach can ingest your full execution history — not just journal entries.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {brokers.slice(0, 4).map((b) => (
                <li key={`${b.broker}-${b.status}-${b.equity_updated_at ?? ''}`} className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-2 font-mono uppercase">
                    <span className={cn(
                      'inline-block h-2 w-2 rounded-full',
                      b.status === 'connected' ? 'bg-emerald-400' : b.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400',
                    )} aria-hidden />
                    {b.broker}
                    {b.is_live && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">live</span>}
                  </div>
                  <div className="text-right tabular-nums">
                    {b.equity_usd != null ? fmtCurrency(b.equity_usd) : '—'}
                  </div>
                </li>
              ))}
              {connectedBrokers.length > 1 && (
                <li className="pt-1 text-[11px] text-muted-foreground">Total equity · <span className="font-semibold tabular-nums text-foreground/80">{fmtCurrency(totalEquity)}</span></li>
              )}
            </ul>
          )}
        </div>
        <div className="surface p-5">
          <SectionHeader icon={CandlestickChart} title="Chart workspace" subtitle="TradingView · multi-chart" cta={{ href: '/workspace', label: 'Open' }} />
          <p className="mt-2 text-[12px] text-foreground/85">
            Charts are a tool, not the lead. Open the workspace when you want to validate an opportunity visually — the coach already filtered the universe for you.
          </p>
          <a
            href="/workspace"
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12px] font-semibold text-amber-300 transition hover:bg-amber-500/15"
          >
            Open workspace <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
          </a>
        </div>
      </section>
    </div>
  )
}


// ─── Sub-components ─────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle, cta }: {
  icon: LucideIcon; title: string; subtitle?: string;
  cta?: { href: string; label: string }
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="flex items-center gap-3">
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
        {cta && (
          <a href={cta.href} className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300/85 hover:text-amber-300 hover:underline">
            {cta.label}<ArrowRight className="h-3 w-3" strokeWidth={2.5} />
          </a>
        )}
      </div>
    </div>
  )
}

function SubScore({ label, score }: { label: string; score: number | null }) {
  const { tone } = bandTone(score)
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-lg font-semibold tabular-nums leading-none', tone)}>
        {score ?? '—'}
      </div>
    </div>
  )
}

function CoachLeadCard({ i }: { i: CoachInsight }) {
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
    <div className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">{i.headline}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">{i.detail}</p>
          {i.evidence && (
            <p className="mt-1.5 font-mono text-[10px] tabular-nums opacity-70">{i.evidence}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function AlertCard({ i }: { i: CoachInsight }) {
  const tone = i.severity === 'critical'
    ? 'border-rose-500/50 bg-rose-500/[0.06] text-rose-200'
    : 'border-amber-500/40 bg-amber-500/[0.06] text-amber-200'
  return (
    <li className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2">
        <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug">{i.headline}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{i.detail}</p>
        </div>
      </div>
    </li>
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
    : 'Caution'

  return (
    <li className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm font-semibold">{r.symbol}</span>
            <span className="rounded border border-current/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">{label}</span>
            {r.regime && <span className="text-[9px] uppercase tracking-wider opacity-70">{r.regime}</span>}
          </div>
          {r.reasons[0] && <p className="mt-1 text-[11px] opacity-90">· {r.reasons[0]}</p>}
        </div>
      </div>
    </li>
  )
}

function Stat({ label, value, positive, hint }: {
  label: string; value: string; positive?: boolean; hint?: string
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
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

function pickLead(insights: CoachInsight[]): CoachInsight | null {
  if (insights.length === 0) return null
  const order: CoachInsight['severity'][] = ['critical', 'warn', 'good', 'info']
  for (const sev of order) {
    const hit = insights.find((i) => i.severity === sev)
    if (hit) return hit
  }
  return insights[0] ?? null
}


function EmptyState({ name }: { name: string | null }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">
        Command <span className="text-gradient">Center</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {name ? `${name.split(' ')[0]}, ` : ''}AlgoSphere is an AI Trader Intelligence
        OS — it reads your trades and tells you what&apos;s working, what isn&apos;t, and what
        to fix next. You haven&apos;t logged a trade yet, so the dashboard is waiting.
      </p>
      <div className="surface mt-6 p-5">
        <SectionHeader icon={Sparkles} title="Get started in three steps" />
        <ol className="mt-3 space-y-2 text-[13px] text-foreground/85">
          <li className="flex gap-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-500/40 text-[10px] font-bold text-amber-300">1</span>
            <span><a href="/brokers" className="font-semibold text-amber-300 hover:underline">Connect a broker</a> so the coach ingests your full execution history (optional but recommended).</span>
          </li>
          <li className="flex gap-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-500/40 text-[10px] font-bold text-amber-300">2</span>
            <span><a href="/journal" className="font-semibold text-amber-300 hover:underline">Log a few trades</a> — pair, direction, entry/exit, P&L. The coach turns on at any sample size.</span>
          </li>
          <li className="flex gap-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-500/40 text-[10px] font-bold text-amber-300">3</span>
            <span>Open the <a href="/intelligence/me" className="font-semibold text-amber-300 hover:underline">AI Coach</a> for the full deep-dive: behavior, performance edges, timing.</span>
          </li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href="/journal" className="inline-flex items-center gap-1 rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90">
            <BookOpen className="h-3.5 w-3.5" /> Log first trade
          </a>
          <a href="/intelligence" className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent/40">
            <Activity className="h-3.5 w-3.5" /> Browse markets
          </a>
        </div>
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
