import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Token Launchpad — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const STATUS_CLS: Record<string, string> = {
  presale: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  live:    'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  listed:  'text-blue-300 border-blue-500/40 bg-blue-500/10',
  draft:   'text-muted-foreground border-border bg-muted/20',
}

export default async function LaunchpadPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('token_launches')
    .select(`*, profiles!token_launches_founder_id_fkey ( public_handle )`)
    .in('status', ['presale', 'live', 'listed'])
    .order('created_at', { ascending: false })
    .limit(30)

  const launches = data ?? []

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Token <span className="text-gradient">Launchpad</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Managed token launches — contract, liquidity lock, vesting, investor portal.
          </p>
        </div>
        <a
          href="/dashboard/launchpad/new"
          className="btn-premium !py-2 !px-4 !text-xs"
        >
          + Launch a Token
        </a>
      </header>

      {/* Service tiers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          { name: 'Standard',     fee: '$2,500',  inc: 'Token + site + dashboard' },
          { name: 'Premium',      fee: '$7,500',  inc: '+ liquidity lock + vesting + investor portal' },
          { name: 'Full Managed', fee: '$20,000', inc: '+ treasury mgmt + AI assistant + marketing' },
        ].map(t => (
          <div key={t.name} className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-bold">{t.name}</p>
            <p className="text-lg font-bold text-amber-300 tabular-nums mt-1">{t.fee}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{t.inc}</p>
          </div>
        ))}
      </div>

      <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
        Live & Upcoming Launches
      </h2>

      {launches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No active launches. Be the first — start a managed launch.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {launches.map((l: any) => {
            const pct = l.hard_cap_usd
              ? Math.min(100, Math.round((Number(l.raised_usd) / Number(l.hard_cap_usd)) * 100))
              : 0
            return (
              <div key={l.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-base">
                      {l.project_name} <span className="text-muted-foreground">${l.ticker}</span>
                    </h3>
                    <p className="text-[11px] text-muted-foreground capitalize">{l.chain}</p>
                  </div>
                  <span className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize',
                    STATUS_CLS[l.status] ?? STATUS_CLS.draft,
                  )}>
                    {l.status}
                  </span>
                </div>
                {l.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                    {l.description}
                  </p>
                )}
                {l.hard_cap_usd && (
                  <>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground">Raised</span>
                      <span className="tabular-nums">
                        ${Number(l.raised_usd).toLocaleString()} / ${Number(l.hard_cap_usd).toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-amber-300"
                        // eslint-disable-next-line react/forbid-dom-props
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
