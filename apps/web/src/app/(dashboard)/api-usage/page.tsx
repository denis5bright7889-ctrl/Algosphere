import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata = { title: 'API Usage & Billing — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const TIER_QUOTA: Record<string, number> = {
  free: 0, starter: 0, premium: 10_000, vip: 100_000,
}

export default async function ApiUsagePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', user.id)
    .single()

  const tier  = profile?.subscription_tier ?? 'free'
  const quota = TIER_QUOTA[tier] ?? 0
  const month = new Date().toISOString().slice(0, 7)

  const { data: meter } = await supabase
    .from('api_usage_meter')
    .select('calls, overage_calls, overage_billed_usd')
    .eq('user_id', user.id)
    .eq('period_month', month)
    .maybeSingle()

  const calls = meter?.calls ?? 0
  const pct   = quota > 0 ? Math.min(100, Math.round((calls / quota) * 100)) : 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          API <span className="text-gradient">Usage & Billing</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Metered REST API. Overage billed at $0.0005/call beyond your monthly quota.
        </p>
      </header>

      {quota === 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] p-6 text-center">
          <p className="text-sm">
            API access is included with <strong>Premium</strong> (10k calls/mo) and
            <strong> VIP</strong> (100k calls/mo).
          </p>
          <a href="/dashboard/upgrade" className="btn-premium mt-4 inline-block !text-sm">
            Upgrade for API access
          </a>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                {month} · {tier.toUpperCase()} plan
              </span>
              <span className="text-sm font-bold tabular-nums">
                {calls.toLocaleString()} / {quota.toLocaleString()}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-gradient-to-r from-amber-500/60 to-amber-300',
                )}
                // eslint-disable-next-line react/forbid-dom-props
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {pct}% of monthly quota used
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Card label="Calls This Month" value={calls.toLocaleString()} />
            <Card label="Overage Calls" value={(meter?.overage_calls ?? 0).toLocaleString()} tone={meter?.overage_calls ? 'amber' : 'plain'} />
            <Card label="Overage Bill" value={`$${Number(meter?.overage_billed_usd ?? 0).toFixed(2)}`} tone={Number(meter?.overage_billed_usd ?? 0) > 0 ? 'amber' : 'plain'} />
          </div>

          <a
            href="/dashboard/api-keys"
            className="block rounded-xl border border-border px-4 py-3 text-sm hover:border-amber-500/40 transition-colors"
          >
            Manage API keys →
          </a>
        </div>
      )}
    </div>
  )
}

function Card({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'amber'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-lg font-bold tabular-nums',
        tone === 'amber' && 'text-amber-300',
      )}>
        {value}
      </p>
    </div>
  )
}
