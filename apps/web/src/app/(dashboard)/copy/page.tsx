import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import CopyPortfolioClient from './CopyPortfolioClient'

export const metadata = { title: 'Copy Portfolio — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function CopyPortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Active subscriptions with strategy + creator info
  const { data: subs } = await supabase
    .from('strategy_subscriptions')
    .select(`
      *,
      published_strategies (
        id, name, slug, win_rate, monthly_return_avg, max_drawdown, sharpe_ratio, copy_enabled,
        profiles!published_strategies_creator_id_fkey ( public_handle )
      )
    `)
    .eq('subscriber_id', user.id)
    .eq('status', 'active')
    .order('started_at', { ascending: false })

  // Aggregate copy_trades for PnL
  const { data: copies } = await supabase
    .from('copy_trades')
    .select('subscription_id, follower_pnl, status, created_at')
    .eq('follower_id', user.id)

  // Group PnL by subscription
  const pnlBySub: Record<string, { total: number; count: number; wins: number }> = {}
  for (const c of copies ?? []) {
    const key = c.subscription_id
    if (!pnlBySub[key]) pnlBySub[key] = { total: 0, count: 0, wins: 0 }
    const pnl = Number(c.follower_pnl ?? 0)
    pnlBySub[key].total += pnl
    pnlBySub[key].count += 1
    if (pnl > 0) pnlBySub[key].wins += 1
  }

  const totalPnl = Object.values(pnlBySub).reduce((s, v) => s + v.total, 0)
  const totalTrades = Object.values(pnlBySub).reduce((s, v) => s + v.count, 0)
  const totalWins = Object.values(pnlBySub).reduce((s, v) => s + v.wins, 0)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Copy <span className="text-gradient">Portfolio</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Manage your active strategy subscriptions and copy settings.
        </p>
      </header>

      {/* Aggregate stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card
          label="Active Subs"
          value={(subs?.length ?? 0).toString()}
        />
        <Card
          label="Total Copies"
          value={totalTrades.toLocaleString()}
        />
        <Card
          label="Win Rate"
          value={totalTrades > 0 ? `${(totalWins / totalTrades * 100).toFixed(0)}%` : '—'}
        />
        <Card
          label="Net P&L"
          value={totalTrades > 0
            ? `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`
            : '—'}
          tone={totalPnl >= 0 ? 'green' : 'red'}
        />
      </div>

      {!subs || subs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            You&apos;re not subscribed to any strategies yet.
          </p>
          <a
            href="/dashboard/strategies"
            className="btn-premium inline-block !text-xs !py-2 !px-4"
          >
            Browse Marketplace
          </a>
        </div>
      ) : (
        <CopyPortfolioClient
          initialSubscriptions={subs as never[]}
          pnlBySub={pnlBySub}
        />
      )}
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
