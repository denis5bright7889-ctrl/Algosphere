import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  effectivePrice,
  verificationLevelLabel,
  type PublishedStrategy,
} from '@/lib/strategies'

export const metadata = { title: 'Strategy Marketplace — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

interface StrategyWithCreator extends PublishedStrategy {
  profiles: {
    public_handle: string | null
    bio:           string | null
  } | null
}

const ASSET_FILTERS = [
  { key: 'all',    label: 'All Markets' },
  { key: 'forex',  label: 'Forex'  },
  { key: 'crypto', label: 'Crypto' },
  { key: 'indices', label: 'Indices' },
  { key: 'commodities', label: 'Commodities' },
] as const

const SORT_OPTIONS = [
  { key: 'popular',   label: 'Most Popular',   col: 'subscribers_count' },
  { key: 'newest',    label: 'Newest',          col: 'published_at'     },
  { key: 'return',    label: 'Highest Return',  col: 'monthly_return_avg' },
  { key: 'sharpe',    label: 'Best Sharpe',     col: 'sharpe_ratio'     },
] as const

export default async function StrategyMarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; sort?: string }>
}) {
  const { asset = 'all', sort = 'popular' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sortOpt = SORT_OPTIONS.find(s => s.key === sort) ?? SORT_OPTIONS[0]

  let query = supabase
    .from('published_strategies')
    .select(`
      *,
      profiles!published_strategies_creator_id_fkey ( public_handle, bio )
    `)
    .eq('status', 'active')
    .order(sortOpt.col, { ascending: false, nullsFirst: false })
    .limit(60)

  if (asset !== 'all') {
    query = query.contains('asset_classes', [asset])
  }

  const { data } = await query
  const strategies = (data ?? []) as StrategyWithCreator[]

  // Check user's existing subscriptions
  const { data: mySubs } = await supabase
    .from('strategy_subscriptions')
    .select('strategy_id, status')
    .eq('subscriber_id', user.id)
    .eq('status', 'active')
  const subscribedIds = new Set((mySubs ?? []).map(s => s.strategy_id))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Strategy <span className="text-gradient">Marketplace</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Subscribe to verified strategies. 70% goes to the creator. Copy-trade VIP only.
          </p>
        </div>
        <a
          href="/dashboard/strategies/new"
          className="btn-premium !py-2 !px-4 !text-xs"
        >
          + Publish Strategy
        </a>
      </header>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 flex-wrap">
          {ASSET_FILTERS.map(f => (
            <a
              key={f.key}
              href={`/dashboard/strategies?asset=${f.key}&sort=${sort}`}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                asset === f.key
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </a>
          ))}
        </div>
        <select
          defaultValue={sort}
          onChange={undefined}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs ml-auto focus:outline-none"
          aria-label="Sort strategies"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {strategies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-14 text-center">
          <p className="text-sm text-muted-foreground">
            No strategies match these filters yet.
          </p>
          <a
            href="/dashboard/strategies/new"
            className="btn-premium mt-4 inline-block !text-sm"
          >
            Be the first to publish
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map(s => (
            <StrategyCard
              key={s.id}
              strategy={s}
              alreadySubscribed={subscribedIds.has(s.id)}
              isOwnCreator={s.creator_id === user.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StrategyCard({
  strategy: s,
  alreadySubscribed,
  isOwnCreator,
}: {
  strategy: StrategyWithCreator
  alreadySubscribed: boolean
  isOwnCreator: boolean
}) {
  const handle = s.profiles?.public_handle
  const monthly = effectivePrice(s, 'monthly')

  return (
    <a
      href={`/dashboard/strategies/${s.slug}`}
      className="group rounded-2xl border border-border bg-card p-5 hover:border-amber-500/40 hover:shadow-card-lift transition-all flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="font-bold text-base truncate group-hover:text-amber-300 transition-colors">
            {s.name}
          </h3>
          {handle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              by <span className="text-foreground">@{handle}</span>
            </p>
          )}
        </div>
        {s.verified && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 flex-shrink-0">
            ✅ {verificationLevelLabel(s.verification_level)}
          </span>
        )}
      </div>

      {s.tagline && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {s.tagline}
        </p>
      )}

      {/* Asset class chips */}
      <div className="flex flex-wrap gap-1 mb-3">
        {s.asset_classes.slice(0, 3).map(ac => (
          <span
            key={ac}
            className="rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] font-medium capitalize"
          >
            {ac}
          </span>
        ))}
      </div>

      {/* Performance grid */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <Metric
          label="Win Rate"
          value={s.win_rate != null ? `${s.win_rate.toFixed(0)}%` : '—'}
          tone="plain"
        />
        <Metric
          label="Mo. Return"
          value={s.monthly_return_avg != null
            ? `${s.monthly_return_avg >= 0 ? '+' : ''}${s.monthly_return_avg.toFixed(1)}%`
            : '—'}
          tone={s.monthly_return_avg != null && s.monthly_return_avg >= 0 ? 'green' : 'red'}
        />
        <Metric
          label="Sharpe"
          value={s.sharpe_ratio != null ? s.sharpe_ratio.toFixed(2) : '—'}
          tone="plain"
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-4">
        <span>⭐ {s.rating_avg ? s.rating_avg.toFixed(1) : '—'} ({s.rating_count})</span>
        <span>·</span>
        <span>{s.subscribers_count.toLocaleString()} subs</span>
        {s.copy_followers_count > 0 && (
          <>
            <span>·</span>
            <span>{s.copy_followers_count} copying</span>
          </>
        )}
      </div>

      {/* Price / CTA */}
      <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between">
        <div>
          {s.is_free ? (
            <p className="text-base font-bold text-emerald-400">Free</p>
          ) : (
            <>
              <p className="text-base font-bold tabular-nums">${monthly}<span className="text-xs text-muted-foreground font-normal">/mo</span></p>
            </>
          )}
        </div>
        <span className={cn(
          'rounded-lg px-3 py-1.5 text-xs font-semibold',
          isOwnCreator
            ? 'border border-border text-muted-foreground'
            : alreadySubscribed
              ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'bg-amber-500/15 border border-amber-500/40 text-amber-300 group-hover:bg-amber-500 group-hover:text-black transition-colors',
        )}>
          {isOwnCreator ? 'Your Strategy' : alreadySubscribed ? '✓ Subscribed' : 'View'}
        </span>
      </div>
    </a>
  )
}

function Metric({ label, value, tone }: {
  label: string; value: string; tone: 'plain' | 'green' | 'red'
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-0.5 text-sm font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}
