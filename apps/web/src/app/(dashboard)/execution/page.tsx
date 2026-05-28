import { redirect } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { tierIncludes } from '@/lib/entitlements'
import { getEffectiveTier } from '@/lib/tier-resolver'
import TierLock from '@/components/tier/TierLock'
import ExecutionClient from './ExecutionClient'
import MirrorChart from './MirrorChart'

export const metadata = { title: 'Execution Dashboard — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function ExecutionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // VIP gate FIRST — the bespoke upgrade card was hand-rolled; the
  // standard <TierLock> primitive is now the one pattern across the
  // app. Gate before the copy_trades / broker_connections queries so
  // locked viewers don't trigger a 3-way Supabase fan-out just to
  // render the upgrade prompt.
  const { tier } = await getEffectiveTier()
  if (!tierIncludes(tier, 'vip')) {
    return (
      <TierLock minTier="vip" tier={tier} from="/execution">
        <ExecutionSkeleton />
      </TierLock>
    )
  }

  // Pull execution data from copy_trades (the live order ledger) +
  // broker readiness (no orders can execute without at least one
  // 'connected' broker, so the LIVE badge has to reflect that truth).
  const [{ data: openCopies }, { data: closedCopies }, { data: brokers }] = await Promise.all([
    supabase
      .from('copy_trades')
      .select('id, symbol, direction, follower_lot, follower_entry, status, created_at, opened_at, signals(regime, confidence_score)')
      .eq('follower_id', user.id)
      .in('status', ['pending', 'mirrored', 'partial'])
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('copy_trades')
      .select('id, symbol, direction, follower_lot, follower_pnl, follower_pnl_pct, status, closed_at, signals(regime, confidence_score)')
      .eq('follower_id', user.id)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(50),
    supabase
      .from('broker_connections')
      .select('status, is_live, is_testnet')
      .eq('user_id', user.id),
  ])

  const open   = openCopies ?? []
  const closed = closedCopies ?? []
  const realizedPnl = closed.reduce((s, c) => s + Number(c.follower_pnl ?? 0), 0)
  const wins = closed.filter(c => Number(c.follower_pnl ?? 0) > 0).length

  // Execution mode — strictly truthful. "Live" requires a broker that
  // is BOTH connected AND live (is_live && !testnet). A connected
  // testnet broker is still simulation (no real money) and must NOT
  // read as live. No connected broker at all = no execution path.
  const anyConnected  = (brokers ?? []).some((b) => b.status === 'connected')
  const liveBrokerReady = (brokers ?? []).some(
    (b) => b.status === 'connected' && b.is_live === true && b.is_testnet !== true,
  )
  const liveState: 'live' | 'idle' | 'simulation' | 'no-broker' =
    liveBrokerReady ? (open.length > 0 ? 'live' : 'idle')
    : anyConnected  ? 'simulation'
    : 'no-broker'
  const livePill = {
    live:        { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: `Live · ${open.length} open` },
    idle:        { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Live · no open positions' },
    simulation:  { cls: 'border-blue-500/40    bg-blue-500/10    text-blue-300',    dot: 'bg-blue-400',    label: 'Simulation Mode' },
    'no-broker': { cls: 'border-rose-500/40    bg-rose-500/10    text-rose-300',    dot: 'bg-rose-400',    label: 'No broker connected' },
  }[liveState]

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Execution <span className="text-gradient">Dashboard</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Live order flow, risk telemetry, and bot health — institutional view.
          </p>
        </div>
        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold',
          livePill.cls,
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', livePill.dot)} aria-hidden />
          {livePill.label}
        </span>
      </header>

      {/* Brief-mandated: when there's no live-broker handshake, the
          order flow below is the copy-relay ledger / paper records —
          NOT broker-confirmed fills. Say so unmistakably. */}
      {!liveBrokerReady && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] px-3 py-2.5 text-xs text-blue-200">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            <span className="font-bold uppercase tracking-wider">Simulation Mode</span>
            {' — '}
            {anyConnected
              ? 'a broker is connected but still on testnet, so orders are simulated, not real-money fills.'
              : 'no live broker is connected. Order flow shown here is the copy-relay ledger / paper record, not broker-confirmed execution.'}
            {' '}Real execution activates only after a broker is connected, validated in{' '}
            <a href="/shadow" className="font-semibold underline hover:no-underline">Shadow Mode</a>,
            and explicitly promoted to live on{' '}
            <a href="/brokers" className="font-semibold underline hover:no-underline">Brokers</a>.
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card label="Open Positions" value={String(open.length)} />
        <Card
          label="Realized PnL"
          // No closed trades → '—'; previously rendered '+$0.00' in green.
          value={closed.length > 0
            ? `${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`
            : '—'}
          tone={closed.length === 0 ? 'plain' : realizedPnl >= 0 ? 'green' : 'red'}
        />
        <Card
          label="Win Rate"
          value={closed.length > 0 ? `${Math.round((wins / closed.length) * 100)}%` : '—'}
        />
        <Card label="Closed Trades" value={String(closed.length)} />
      </div>

      {/* Live execution mirror chart — fills overlaid on price */}
      <div className="mb-6">
        <MirrorChart />
      </div>

      <ExecutionClient open={open as never[]} closed={closed as never[]} />
    </div>
  )
}

function Card({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'red'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-xl font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}

/**
 * Locked preview — same shape as the real dashboard so the upgrade card
 * sits on a credible institutional surface, but no Supabase round-trip
 * and no real numbers. Pure chrome; the lock overlay carries the CTA.
 */
function ExecutionSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Execution <span className="text-gradient">Dashboard</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Live order flow, risk telemetry, and bot health — institutional view.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          Live · 3 open
        </span>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card label="Open Positions" value="3" />
        <Card label="Realized PnL"   value="+$2,415.20" tone="green" />
        <Card label="Win Rate"       value="68%" />
        <Card label="Closed Trades"  value="41" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/10 p-12 text-center text-sm text-muted-foreground">
        Live order flow + risk telemetry stream renders here in the VIP tier.
      </div>
    </div>
  )
}
