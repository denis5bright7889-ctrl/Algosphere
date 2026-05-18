import { redirect } from 'next/navigation'
import { Cpu } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import ExecutionClient from './ExecutionClient'

export const metadata = { title: 'Execution Dashboard — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function ExecutionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // VIP gate
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id)
    .single()

  const tier = profile?.subscription_tier ?? 'free'
  const isVip = tier === 'vip' || (profile?.account_type ?? '').includes('vip')

  if (!isVip) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Cpu className="mx-auto h-10 w-10 text-amber-300" strokeWidth={1.5} aria-hidden />
        <h1 className="text-2xl font-bold tracking-tight mt-4">
          Automated Execution Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Live bot positions, floating PnL, execution latency, and the
          institutional risk telemetry stream are part of the VIP / Institutional tier.
        </p>
        <a href="/upgrade" className="btn-premium mt-6 inline-block !text-sm">
          Upgrade to VIP — $299/mo
        </a>
      </div>
    )
  }

  // Pull execution data from copy_trades (the live order ledger) +
  // broker readiness (no orders can execute without at least one
  // 'connected' broker, so the LIVE badge has to reflect that truth).
  const [{ data: openCopies }, { data: closedCopies }, { data: brokers }] = await Promise.all([
    supabase
      .from('copy_trades')
      .select('id, symbol, direction, follower_lot, follower_entry, status, created_at, opened_at')
      .eq('follower_id', user.id)
      .in('status', ['pending', 'mirrored', 'partial'])
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('copy_trades')
      .select('id, symbol, direction, follower_lot, follower_pnl, follower_pnl_pct, status, closed_at')
      .eq('follower_id', user.id)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(50),
    supabase
      .from('broker_connections')
      .select('status')
      .eq('user_id', user.id),
  ])

  const open   = openCopies ?? []
  const closed = closedCopies ?? []
  const realizedPnl = closed.reduce((s, c) => s + Number(c.follower_pnl ?? 0), 0)
  const wins = closed.filter(c => Number(c.follower_pnl ?? 0) > 0).length

  // Truthful execution-state pill — never a static '● LIVE' claim.
  const brokerReady = (brokers ?? []).some((b) => b.status === 'connected')
  const liveState: 'live' | 'idle' | 'no-broker' =
    !brokerReady ? 'no-broker' : open.length > 0 ? 'live' : 'idle'
  const livePill = {
    live:        { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', label: `Live · ${open.length} open` },
    idle:        { cls: 'border-amber-500/40   bg-amber-500/10   text-amber-300',   dot: 'bg-amber-400',   label: 'Idle · no open positions' },
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
