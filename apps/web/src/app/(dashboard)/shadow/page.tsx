import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Shadow Execution Mode — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

interface ShadowRow {
  id: string
  symbol: string
  direction: string
  broker: string
  intended_lot: number
  intended_entry: number | null
  actual_status: string
  actual_fill_price: number | null
  slippage_pct: number | null
  skip_reason: string | null
  leader_pnl: number | null
  follower_pnl: number | null
  pnl_drift_pct: number | null
  created_at: string
  closed_at: string | null
}

export default async function ShadowPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('shadow_executions')
    .select(`
      id, symbol, direction, broker, intended_lot, intended_entry,
      actual_status, actual_fill_price, slippage_pct, skip_reason,
      leader_pnl, follower_pnl, pnl_drift_pct, created_at, closed_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const list = (rows ?? []) as ShadowRow[]
  const closed = list.filter(r => r.closed_at)
  const mirrored = list.filter(r => r.actual_status === 'mirrored' || r.actual_status === 'testnet').length
  const fillRate = list.length > 0 ? Math.round((mirrored / list.length) * 100) : 0

  const avgSlippage = closed.length > 0
    ? closed.reduce((s, r) => s + Math.abs(Number(r.slippage_pct ?? 0)), 0) / closed.length
    : 0
  const avgDrift = closed.filter(r => r.pnl_drift_pct != null).length > 0
    ? closed.reduce((s, r) => s + Math.abs(Number(r.pnl_drift_pct ?? 0)), 0)
      / closed.filter(r => r.pnl_drift_pct != null).length
    : 0

  // Heuristic readiness — flip from testnet→live when:
  //  • ≥50 executions
  //  • ≥95% fill rate
  //  • avg slippage <0.1%
  //  • avg drift <2%
  const ready = list.length >= 50 && fillRate >= 95 && avgSlippage < 0.001 && avgDrift < 2

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Shadow <span className="text-gradient">Execution Mode</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Every full-auto copy trade is recorded with intent + outcome. Use these
          metrics to validate broker quality before going from testnet → live.
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Total Executions" value={String(list.length)} />
        <Stat label="Fill Rate" value={`${fillRate}%`}
          tone={fillRate >= 95 ? 'green' : fillRate >= 80 ? 'amber' : 'red'} />
        <Stat label="Avg Slippage" value={`${(avgSlippage * 100).toFixed(3)}%`}
          tone={avgSlippage < 0.001 ? 'green' : avgSlippage < 0.005 ? 'amber' : 'red'} />
        <Stat label="Avg PnL Drift" value={`${avgDrift.toFixed(2)}%`}
          tone={avgDrift < 2 ? 'green' : avgDrift < 5 ? 'amber' : 'red'} />
      </div>

      <div className={cn(
        'rounded-2xl border p-5 mb-6',
        ready ? 'border-emerald-500/40 bg-emerald-500/[0.04]' : 'border-amber-500/30 bg-amber-500/[0.04]',
      )}>
        <p className="text-xs uppercase tracking-widest font-bold mb-2">
          {ready ? '✓ Ready for Live' : '⏳ Validation in Progress'}
        </p>
        <p className="text-sm text-muted-foreground">
          Live execution unlock requires: <strong>50+ executions, ≥95% fill rate,
          &lt;0.1% avg slippage, &lt;2% PnL drift</strong>. You&apos;ve completed{' '}
          {Math.min(list.length, 50)}/50 executions
          {list.length < 50 && ` · ${50 - list.length} more needed`}.
        </p>
      </div>

      <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
        Recent Executions
      </h2>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No shadow executions yet. Subscribe to a strategy in full-auto mode to start logging.
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="text-left text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/40">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Dir</th>
                <th className="px-4 py-2.5 text-right">Intended</th>
                <th className="px-4 py-2.5 text-right">Filled</th>
                <th className="px-4 py-2.5 text-right">Slip</th>
                <th className="px-4 py-2.5 text-right">Drift</th>
                <th className="px-4 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} className="border-b border-border/30 last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-2 text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono">{r.symbol}</td>
                  <td className={cn(
                    'px-4 py-2 font-bold',
                    r.direction === 'buy' ? 'text-emerald-400' : 'text-rose-400',
                  )}>
                    {r.direction.toUpperCase()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.intended_lot} @ {r.intended_entry ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.actual_fill_price ?? '—'}
                  </td>
                  <td className={cn(
                    'px-4 py-2 text-right tabular-nums',
                    Math.abs(Number(r.slippage_pct ?? 0)) < 0.001 ? 'text-emerald-400'
                      : Math.abs(Number(r.slippage_pct ?? 0)) < 0.005 ? 'text-amber-300'
                      : 'text-rose-400',
                  )}>
                    {r.slippage_pct != null ? `${(r.slippage_pct * 100).toFixed(3)}%` : '—'}
                  </td>
                  <td className={cn(
                    'px-4 py-2 text-right tabular-nums',
                    r.pnl_drift_pct != null && Math.abs(r.pnl_drift_pct) < 2 ? 'text-emerald-400'
                      : r.pnl_drift_pct != null && Math.abs(r.pnl_drift_pct) < 5 ? 'text-amber-300'
                      : r.pnl_drift_pct != null ? 'text-rose-400' : 'text-muted-foreground',
                  )}>
                    {r.pnl_drift_pct != null ? `${r.pnl_drift_pct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={cn(
                      'rounded-full border px-2 py-0.5 text-[9px] font-bold capitalize',
                      r.actual_status === 'mirrored' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                      r.actual_status === 'testnet'  && 'border-blue-500/40 bg-blue-500/10 text-blue-300',
                      r.actual_status === 'failed'   && 'border-rose-500/40 bg-rose-500/10 text-rose-300',
                      (r.actual_status === 'skipped' || r.actual_status === 'shadow_only') && 'border-border bg-muted/30 text-muted-foreground',
                    )}>
                      {r.actual_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'amber' | 'red'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-xl font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'amber' && 'text-amber-300',
        tone === 'red'   && 'text-rose-400',
      )}>{value}</p>
    </div>
  )
}
