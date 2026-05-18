import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BadgeCheck, FlaskConical, AlertCircle, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  effectivePrice,
  verificationLevelLabel,
  trustScore,
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
  { key: 'trust',     label: 'Trust Score',    col: 'subscribers_count' },
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
  let strategies = (data ?? []) as StrategyWithCreator[]

  // 'Trust' has no single DB column — it's a transparent composite.
  // We fetch the top-engagement 60 (via sortOpt.col) then re-rank that
  // set by trustScore so verification + ratings + depth decide order.
  if (sort === 'trust') {
    strategies = [...strategies].sort((a, b) => trustScore(b) - trustScore(a))
  }

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
          href="/strategies/new"
          className="btn-premium !py-2 !px-4 !text-xs"
        >
          + Publish Strategy
        </a>
      </header>

      {/* Filters — link-driven, zero JS. The previous <select> had
          onChange={undefined}, so changing it did nothing; this row of
          links reuses the same href pattern as the asset filters above
          so the UI stays consistent and the URL is the single source
          of truth for filter+sort state. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {ASSET_FILTERS.map(f => (
            <a
              key={f.key}
              href={`/strategies?asset=${f.key}&sort=${sort}`}
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
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mr-1">
            Sort
          </span>
          {SORT_OPTIONS.map(o => (
            <a
              key={o.key}
              href={`/strategies?asset=${asset}&sort=${o.key}`}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                sort === o.key
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </a>
          ))}
        </div>
      </div>

      {/* Grid */}
      {strategies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-14 text-center">
          <p className="text-sm text-muted-foreground">
            No strategies match these filters yet.
          </p>
          <a
            href="/strategies/new"
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
  const trust = trustScore(s)

  // Same data-source taxonomy as the detail page's PerformanceSection:
  // 'live' > 'backtest' > 'unverified'. Drives both the source chip
  // and whether we show the metric grid at all.
  const hasSignals = s.total_signals > 0
  const isLive = s.verification_level === 'live_30d'
              || s.verification_level === 'live_90d'
              || s.verification_level === 'live_180d'
  const isBacktest = s.verification_level === 'backtested'
  const isUnverified = !isLive && !isBacktest && !hasSignals

  return (
    <a
      href={`/strategies/${s.slug}`}
      className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:border-amber-500/40 hover:shadow-card-lift"
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold transition-colors group-hover:text-amber-300">
            {s.name}
          </h3>
          {handle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              by <span className="text-foreground">@{handle}</span>
            </p>
          )}
        </div>
        <SourceChip
          isLive={isLive}
          isBacktest={isBacktest}
          isUnverified={isUnverified}
          level={s.verification_level}
        />
      </div>

      {s.tagline && (
        <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
          {s.tagline}
        </p>
      )}

      {/* Asset class chips */}
      <div className="mb-3 flex flex-wrap gap-1">
        {s.asset_classes.slice(0, 3).map(ac => (
          <span
            key={ac}
            className="rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] font-medium capitalize"
          >
            {ac}
          </span>
        ))}
      </div>

      {/* Performance grid — hidden for unverified/0-signal strategies so
          dashed metrics don't read as 'zero performance'. Honest empty
          state is shown instead. */}
      {isUnverified ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
          <Activity className="h-3.5 w-3.5 shrink-0 text-amber-300/60" strokeWidth={1.75} aria-hidden />
          <span>Awaiting first signals — no track record to display yet.</span>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
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
      )}

      {/* Stats row */}
      <div className="mb-4 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span
          title="Transparent composite: verification level + engagement + ratings + track-record depth"
          className={cn(
            'rounded px-1.5 py-0.5 font-bold tabular-nums',
            trust >= 60 ? 'bg-emerald-500/15 text-emerald-300'
              : trust >= 30 ? 'bg-amber-500/15 text-amber-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          Trust {trust}
        </span>
        <span>·</span>
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

/**
 * Truthful source-of-data chip for a marketplace card. Priority:
 *   live  → emerald 'Live N+ days' (existing verified treatment)
 *   backtested → violet 'Simulation · Backtest'
 *   unverified → amber 'Unverified'
 * Mirrors the chip system on the detail page so a viewer scanning the
 * grid sees the same truth they'll see after clicking.
 */
function SourceChip({
  isLive, isBacktest, isUnverified, level,
}: {
  isLive: boolean
  isBacktest: boolean
  isUnverified: boolean
  level: PublishedStrategy['verification_level']
}) {
  if (isLive) {
    return (
      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
        <BadgeCheck className="h-3 w-3" strokeWidth={2} aria-hidden />
        {verificationLevelLabel(level)}
      </span>
    )
  }
  if (isBacktest) {
    return (
      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300">
        <FlaskConical className="h-3 w-3" strokeWidth={2} aria-hidden />
        Simulation
      </span>
    )
  }
  if (isUnverified) {
    return (
      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
        <AlertCircle className="h-3 w-3" strokeWidth={2} aria-hidden />
        Unverified
      </span>
    )
  }
  // Strategy has published signals but isn't yet at a live-Nd threshold.
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
      <AlertCircle className="h-3 w-3" strokeWidth={2} aria-hidden />
      Building track record
    </span>
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
