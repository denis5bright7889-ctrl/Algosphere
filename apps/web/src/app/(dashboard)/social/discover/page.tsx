import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  verificationBadge,
  riskBadge,
  formatScore,
  type VerificationTier,
} from '@/lib/leaderboard'

export const metadata = { title: 'Discover Traders — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const RISK_FILTERS = ['all', 'low', 'medium', 'high'] as const
const TIER_FILTERS = ['all', 'verified', 'elite'] as const

interface ScoreRow {
  user_id:          string
  composite_score:  number
  win_rate:         number | null
  monthly_return_pct: number | null
  total_trades:     number
  followers_count:  number
  risk_label:       string
  profiles: { public_handle: string | null; bio: string | null } | null
  trader_verifications: { tier: string } | null
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; risk?: string; tier?: string }>
}) {
  const { q = '', risk = 'all', tier = 'all' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let query = supabase
    .from('trader_scores')
    .select(`
      user_id, composite_score, win_rate, monthly_return_pct,
      total_trades, followers_count, risk_label,
      profiles!inner ( public_handle, bio ),
      trader_verifications ( tier )
    `)
    .gte('total_trades', 5)
    .order('composite_score', { ascending: false })
    .limit(50)

  if (risk !== 'all') query = query.eq('risk_label', risk)

  const { data } = await query
  let rows = (data ?? []) as unknown as ScoreRow[]

  // Client-side filters that can't be expressed in the join cleanly
  if (q.trim()) {
    const needle = q.trim().toLowerCase()
    rows = rows.filter(r =>
      r.profiles?.public_handle?.toLowerCase().includes(needle) ||
      r.profiles?.bio?.toLowerCase().includes(needle)
    )
  }
  if (tier !== 'all') {
    rows = rows.filter(r => (r.trader_verifications?.tier ?? 'none') === tier)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          Discover <span className="text-gradient">Traders</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Find traders to follow and copy. Search by handle or bio.
        </p>
      </header>

      {/* Search + filters */}
      <form className="mb-5 flex flex-wrap gap-2" action="/dashboard/social/discover">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search handle or bio…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
        />
        <select
          name="risk"
          defaultValue={risk}
          className="rounded-lg border border-border bg-card px-3 py-2 text-xs focus:outline-none"
          aria-label="Filter by risk"
        >
          {RISK_FILTERS.map(r => (
            <option key={r} value={r}>
              {r === 'all' ? 'Any risk' : `${r.charAt(0).toUpperCase()}${r.slice(1)} risk`}
            </option>
          ))}
        </select>
        <select
          name="tier"
          defaultValue={tier}
          className="rounded-lg border border-border bg-card px-3 py-2 text-xs focus:outline-none"
          aria-label="Filter by verification"
        >
          {TIER_FILTERS.map(t => (
            <option key={t} value={t}>
              {t === 'all' ? 'Any tier' : t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-premium !py-2 !px-4 !text-xs">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {q ? `No traders match "${q}".` : 'No ranked traders match these filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map(r => {
            const tierVal = (r.trader_verifications?.tier ?? 'none') as VerificationTier
            const badge   = verificationBadge(tierVal)
            const rk      = riskBadge(r.risk_label)
            const handle  = r.profiles?.public_handle
            if (!handle) return null
            return (
              <a
                key={r.user_id}
                href={`/traders/${handle}`}
                className="group rounded-2xl border border-border bg-card p-4 hover:border-amber-500/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-400/40 to-amber-700/40 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-300 flex-shrink-0">
                      {handle[0]?.toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate group-hover:text-amber-300 transition-colors">
                        @{handle}
                      </p>
                      {badge && (
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold',
                          badge.cls,
                        )}>
                          {badge.icon} {badge.label}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-amber-300 font-bold tabular-nums text-sm">
                    {formatScore(r.composite_score)}
                  </span>
                </div>

                {r.profiles?.bio && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mb-3">
                    {r.profiles.bio}
                  </p>
                )}

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>WR {r.win_rate != null ? `${r.win_rate.toFixed(0)}%` : '—'}</span>
                  <span>·</span>
                  <span className={cn(
                    r.monthly_return_pct != null && r.monthly_return_pct >= 0
                      ? 'text-emerald-400' : 'text-rose-400',
                  )}>
                    {r.monthly_return_pct != null
                      ? `${r.monthly_return_pct >= 0 ? '+' : ''}${r.monthly_return_pct.toFixed(1)}%/mo`
                      : '—'}
                  </span>
                  <span>·</span>
                  <span>{r.followers_count} followers</span>
                  <span className={cn(
                    'ml-auto inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold capitalize',
                    rk.cls,
                  )}>
                    <span className={cn('h-1 w-1 rounded-full', rk.dot)} />
                    {r.risk_label}
                  </span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
