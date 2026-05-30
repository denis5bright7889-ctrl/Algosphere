/**
 * /execution/monitor — Automation Monitor (Refocus V3).
 *
 * V3 puts automation downstream of intelligence (Analyze → Optimize →
 * Validate → Automate). This surface answers a single, honest question:
 * "Is my automation pipeline working right now?"
 *
 * Four reads, all from live sources — no fabrication:
 *   1. Engine pulse  — signal-engine /status (enabled, symbols, provider, time)
 *   2. Risk state    — signal-engine /risk/telemetry (ACTIVE / COOLDOWN / LOCKED + DD)
 *   3. Live feeds    — broker_connections rows (count of live + connected)
 *   4. Recent signals — latest 8 rows from `signals` (engine output going to users)
 *
 * The retired surface (R7) was the copy-engine monitor; its tables were
 * dropped. This is a from-scratch monitor that does not depend on
 * copy-trading at all — pure read of the live automation pipeline.
 */
import { notFound, redirect } from 'next/navigation'
import {
  Radar, ShieldAlert, Server, Cpu, AlertOctagon, CheckCircle2,
  Pause, Lock, type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { cn } from '@/lib/utils'
import {
  getEngineStatus, getRiskTelemetry,
  type EngineStatus, type RiskTelemetry, type Result,
} from '@/lib/engine-client'

export const metadata = { title: 'Automation Monitor — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

interface BrokerRow {
  broker: string
  status: string
  is_live: boolean | null
  equity_usd: number | null
  equity_updated_at: string | null
}

interface SignalRow {
  id: string
  pair: string
  direction: string
  status: string
  published_at: string | null
  result: string | null
}

export default async function AutomationMonitorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Admin-only — operational/diagnostic surface. See
  // [[feedback_admin_vs_user_surfaces]]: this page exposes engine
  // internals (regime telemetry, risk gate state, broker fill streams)
  // that belong in the admin/operator panel, not in a trader's
  // workflow. Non-admin direct-URL access 404s.
  if (!isAdmin(user.email)) notFound()

  const [engineRes, riskRes, brokersRes, signalsRes] = await Promise.all([
    getEngineStatus(),
    getRiskTelemetry(),
    supabase.from('broker_connections')
      .select('broker, status, is_live, equity_usd, equity_updated_at')
      .eq('user_id', user.id),
    supabase.from('signals')
      .select('id, pair, direction, status, published_at, result')
      .order('published_at', { ascending: false })
      .limit(8),
  ])

  const brokers = (brokersRes.data ?? []) as BrokerRow[]
  const signals = (signalsRes.data ?? []) as SignalRow[]
  const liveBrokers      = brokers.filter((b) => b.status === 'connected' && b.is_live)
  const connectedBrokers = brokers.filter((b) => b.status === 'connected')

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Automation <span className="text-gradient">Monitor</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Is my automation pipeline working? Engine pulse, risk state, live broker feeds, and recent signals — one decision surface.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <EnginePulseCard engine={engineRes} />
        <RiskStateCard   risk={riskRes} />
      </div>

      <FeedHealthCard
        liveCount={liveBrokers.length}
        connectedCount={connectedBrokers.length}
        totalCount={brokers.length}
        brokers={brokers}
      />

      <RecentSignalsCard signals={signals} />
    </div>
  )
}


// ─── Engine Pulse ────────────────────────────────────────────────────

function EnginePulseCard({ engine }: { engine: Result<EngineStatus> }) {
  if (!engine.ok) {
    return (
      <Card icon={Radar} title="Engine pulse" subtitle="Signal generator">
        <Banner tone="rose" icon={AlertOctagon}>
          Engine unreachable: {engine.error}. The web app cached the last good payload — automation continues running on the engine even if this read fails.
        </Banner>
      </Card>
    )
  }
  const e = engine.data
  const tone = e.enabled ? 'emerald' : 'amber'
  return (
    <Card icon={Radar} title="Engine pulse" subtitle="Signal generator">
      <Banner tone={tone} icon={e.enabled ? CheckCircle2 : Pause}>
        <span className="font-semibold">{e.enabled ? 'Online' : 'Paused'}</span>
        {' · '}{e.provider}{' · '}{e.timeframe}
      </Banner>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <KV label="Symbols watched" value={String(e.symbols.length)} />
        <KV label="WS connections"  value={String(e.websocket.connections ?? '—')} />
        <KV label="Last tick"       value={e.time ? new Date(e.time).toLocaleTimeString() : '—'} />
        <KV label="Timeframe"       value={e.timeframe} />
      </div>
    </Card>
  )
}


// ─── Risk State ──────────────────────────────────────────────────────

function RiskStateCard({ risk }: { risk: Result<RiskTelemetry> }) {
  if (!risk.ok) {
    return (
      <Card icon={ShieldAlert} title="Risk state" subtitle="Capital gate">
        <Banner tone="amber" icon={Pause}>
          Risk telemetry unavailable: {risk.error}. The capital gate still runs server-side on the engine; this is a UI read failure.
        </Banner>
      </Card>
    )
  }
  const r = risk.data
  const tone =
    r.state === 'ACTIVE'   ? 'emerald'
    : r.state === 'COOLDOWN' ? 'amber'
    : 'rose'
  const StateIcon =
    r.state === 'ACTIVE'   ? CheckCircle2
    : r.state === 'COOLDOWN' ? Pause
    : Lock
  return (
    <Card icon={ShieldAlert} title="Risk state" subtitle="Capital gate">
      <Banner tone={tone} icon={StateIcon}>
        <span className="font-semibold">{r.state}</span>
        {r.account_login != null && <> · acct {r.account_login}</>}
      </Banner>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <KV label="Current equity" value={fmtUsd(r.current_equity)} />
        <KV label="Daily P&L"      value={fmtUsd(r.daily_pnl)} tone={signTone(r.daily_pnl)} />
        <KV label="Daily DD"       value={fmtPct(r.daily_drawdown_pct)} tone={r.daily_drawdown_pct != null && r.daily_drawdown_pct > 0.03 ? 'text-rose-300' : undefined} />
        <KV label="Total DD"       value={fmtPct(r.total_drawdown_pct)} tone={r.total_drawdown_pct != null && r.total_drawdown_pct > 0.1 ? 'text-rose-300' : undefined} />
        <KV label="Consec. wins"   value={String(r.consecutive_wins ?? '—')} />
        <KV label="Consec. losses" value={String(r.consecutive_losses ?? '—')} tone={r.consecutive_losses != null && r.consecutive_losses >= 3 ? 'text-rose-300' : undefined} />
      </div>
    </Card>
  )
}


// ─── Feed Health ─────────────────────────────────────────────────────

function FeedHealthCard({ liveCount, connectedCount, totalCount, brokers }: {
  liveCount: number; connectedCount: number; totalCount: number; brokers: BrokerRow[]
}) {
  if (totalCount === 0) {
    return (
      <Card icon={Server} title="Live feeds" subtitle="Broker connections">
        <p className="text-[12px] text-muted-foreground">
          No brokers connected. <a href="/brokers" className="text-amber-300 hover:underline">Connect one</a> to start feeding live execution data into the automation pipeline.
        </p>
      </Card>
    )
  }
  return (
    <Card icon={Server} title="Live feeds" subtitle="Broker connections">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Tile label="Live"      value={liveCount}      tone={liveCount > 0 ? 'text-emerald-300' : 'text-muted-foreground/60'} />
        <Tile label="Connected" value={connectedCount} tone={connectedCount > 0 ? 'text-amber-300' : 'text-muted-foreground/60'} />
        <Tile label="Total"     value={totalCount}     tone="text-foreground" />
      </div>
      {brokers.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[12px]">
          {brokers.slice(0, 5).map((b) => (
            <li key={`${b.broker}-${b.equity_updated_at ?? ''}`} className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'inline-block h-2 w-2 rounded-full',
                  b.status === 'connected' ? 'bg-emerald-400' : b.status === 'failed' ? 'bg-rose-400' : 'bg-amber-400',
                )} aria-hidden />
                <span className="font-mono uppercase">{b.broker}</span>
                {b.is_live && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">live</span>}
              </div>
              <span className="text-muted-foreground tabular-nums">{fmtUsd(b.equity_usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}


// ─── Recent Signals ──────────────────────────────────────────────────

function RecentSignalsCard({ signals }: { signals: SignalRow[] }) {
  return (
    <Card icon={Cpu} title="Recent automation output" subtitle="Last 8 signals">
      {signals.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No signals published in the recent window. The engine publishes when its confluence threshold is met — silence is honest, not a fault.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {signals.map((s) => {
            const resultTone =
              s.result === 'win'    ? 'text-emerald-300'
              : s.result === 'loss' ? 'text-rose-300'
              : 'text-muted-foreground'
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-1.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{s.pair}</span>
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                    s.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                  )}>
                    {s.direction}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.status}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn('text-[10px] uppercase tracking-wider', resultTone)}>
                    {s.result ?? '—'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                    {s.published_at ? new Date(s.published_at).toLocaleTimeString() : '—'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}


// ─── Primitives ──────────────────────────────────────────────────────

function Card({ icon: Icon, title, subtitle, children }: {
  icon: LucideIcon; title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

function Banner({ tone, icon: Icon, children }: {
  tone: 'emerald' | 'amber' | 'rose'; icon: LucideIcon; children: React.ReactNode
}) {
  const cls = {
    emerald: 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-200',
    amber:   'border-amber-500/40   bg-amber-500/[0.06]   text-amber-200',
    rose:    'border-rose-500/40    bg-rose-500/[0.06]    text-rose-200',
  }[tone]
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border p-2.5 text-[12px]', cls)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function KV({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn('font-semibold tabular-nums', tone)}>{value}</span>
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-2xl font-semibold tabular-nums leading-none', tone)}>{value}</div>
    </div>
  )
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs  = Math.abs(n)
  if (abs >= 1000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `${sign}$${abs.toFixed(2)}`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function signTone(n: number | null | undefined): string | undefined {
  if (n == null) return undefined
  if (n > 0) return 'text-emerald-300'
  if (n < 0) return 'text-rose-300'
  return undefined
}
