import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Prop Firm Toolkit — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function PropPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: challenges } = await supabase
    .from('prop_challenges')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Prop Firm <span className="text-gradient">Toolkit</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Track FTMO-style challenge progress, drawdown limits, and trading-day quotas.
          </p>
        </div>
        <a href="/dashboard/prop/new" className="btn-premium !py-2 !px-4 !text-xs">
          + New Challenge
        </a>
      </header>

      {!challenges || challenges.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-14 text-center">
          <p className="text-sm text-muted-foreground">No active challenges. Start one to begin tracking.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {challenges.map((c: any) => <ChallengeCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  )
}

function ChallengeCard({ c }: { c: any }) {
  const start   = Number(c.account_size_usd)
  const current = Number(c.current_balance_usd ?? c.account_size_usd)
  const profit  = current - start
  const profitPct = (profit / start) * 100
  const dailyPnl  = Number(c.current_daily_pnl_usd ?? 0)
  const dailyPct  = (dailyPnl / start) * 100

  const profitTarget = Number(c.profit_target_pct)
  const dailyLimit   = Number(c.max_daily_loss_pct)
  const totalLimit   = Number(c.max_total_loss_pct)

  const progressPct = Math.max(0, Math.min(100, (profitPct / profitTarget) * 100))
  const dailyDDpct  = Math.min(100, (Math.abs(Math.min(dailyPct, 0)) / dailyLimit) * 100)
  const totalDDpct  = Math.min(100, (Math.abs(Math.min(profitPct, 0)) / totalLimit) * 100)

  const breachDaily = Math.abs(dailyPct) >= dailyLimit
  const breachTotal = profitPct <= -totalLimit
  const passed      = profitPct >= profitTarget

  const statusCls =
    breachDaily || breachTotal ? 'text-rose-300 border-rose-500/40 bg-rose-500/10'
    : passed                   ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
    :                            'text-amber-300 border-amber-500/40 bg-amber-500/10'

  const statusLabel = breachTotal ? 'BREACHED — Total DD'
    : breachDaily ? 'BREACHED — Daily DD'
    : passed ? 'PASSED'
    : c.status?.toUpperCase()

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="font-bold text-base">
            {c.firm_name} <span className="text-muted-foreground">${start.toLocaleString()}</span>
          </h3>
          <p className="text-[11px] text-muted-foreground capitalize mt-0.5">
            {c.phase} phase · Started {new Date(c.started_at).toLocaleDateString()}
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider',
          statusCls,
        )}>
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat
          label="Current Balance"
          value={`$${current.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          tone={profit >= 0 ? 'green' : 'red'}
        />
        <Stat
          label="Profit"
          value={`${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%`}
          tone={profitPct >= 0 ? 'green' : 'red'}
        />
        <Stat label="Daily P&L" value={`$${dailyPnl.toFixed(0)}`} tone={dailyPnl >= 0 ? 'green' : 'red'} />
        <Stat label="Days Trading" value="—" />
      </div>

      <div className="space-y-3">
        <ProgressRow
          label="Profit Target"
          current={`${Math.max(0, profitPct).toFixed(2)}% / ${profitTarget}%`}
          pct={progressPct}
          tone="green"
        />
        <ProgressRow
          label="Daily Loss"
          current={`${Math.abs(dailyPct).toFixed(2)}% / ${dailyLimit}%`}
          pct={dailyDDpct}
          tone="red"
        />
        <ProgressRow
          label="Total Drawdown"
          current={`${Math.abs(Math.min(profitPct, 0)).toFixed(2)}% / ${totalLimit}%`}
          pct={totalDDpct}
          tone="red"
        />
      </div>

      {(breachDaily || breachTotal) && (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
          ⚠ Hard stop reached. Stop trading this account immediately to preserve eligibility.
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'red'
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-0.5 text-base font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}

function ProgressRow({ label, current, pct, tone }: {
  label: string; current: string; pct: number; tone: 'green' | 'red'
}) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums">{current}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            tone === 'green' ? 'bg-gradient-to-r from-emerald-500/60 to-emerald-300'
                             : pct >= 75 ? 'bg-rose-500'
                             : pct >= 50 ? 'bg-amber-500'
                             : 'bg-gradient-to-r from-amber-500/60 to-amber-300',
          )}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
