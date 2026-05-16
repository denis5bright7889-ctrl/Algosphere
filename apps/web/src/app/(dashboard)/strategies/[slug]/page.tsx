import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import {
  verificationLevelLabel,
  type PublishedStrategy,
} from '@/lib/strategies'
import SubscribeStrategyCard from './SubscribeStrategyCard'
import ReviewForm from '@/components/social/ReviewForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return { title: `${slug} — Strategy · AlgoSphere Quant` }
}

interface FullStrategy extends PublishedStrategy {
  profiles: {
    id:            string
    public_handle: string | null
    bio:           string | null
    created_at:    string
  } | null
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: strategy } = await supabase
    .from('published_strategies')
    .select(`
      *,
      profiles!published_strategies_creator_id_fkey ( id, public_handle, bio, created_at )
    `)
    .eq('slug', slug)
    .single()

  if (!strategy) notFound()

  const s = strategy as FullStrategy
  const isOwnCreator = s.creator_id === user.id

  // Existing subscription
  const { data: mySub } = await supabase
    .from('strategy_subscriptions')
    .select('*')
    .eq('subscriber_id', user.id)
    .eq('strategy_id', s.id)
    .maybeSingle()

  // Reviews
  const { data: reviews } = await supabase
    .from('strategy_reviews')
    .select(`
      *,
      profiles!strategy_reviews_reviewer_id_fkey ( public_handle )
    `)
    .eq('strategy_id', s.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // Can this user review? (not creator, hasn't reviewed yet)
  const alreadyReviewed = (reviews ?? []).some(
    (r: any) => r.reviewer_id === user.id
  )
  const canReview = !isOwnCreator && !alreadyReviewed

  const handle = s.profiles?.public_handle

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <a
        href="/dashboard/strategies"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
      >
        ← Marketplace
      </a>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header card */}
          <div className="rounded-2xl border border-border bg-card p-6 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />

            <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{s.name}</h1>
                {handle && (
                  <p className="text-sm text-muted-foreground mt-1">
                    by{' '}
                    <a
                      href={`/traders/${handle}`}
                      className="text-foreground hover:text-amber-300"
                    >
                      @{handle}
                    </a>
                    {s.profiles?.created_at && (
                      <> · since {formatDate(s.profiles.created_at)}</>
                    )}
                  </p>
                )}
              </div>
              {s.verified && (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">
                  ✅ {verificationLevelLabel(s.verification_level)}
                </span>
              )}
            </div>

            {s.tagline && (
              <p className="text-base text-muted-foreground">{s.tagline}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-1.5">
              {s.asset_classes.map(ac => (
                <span
                  key={ac}
                  className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] font-medium capitalize"
                >
                  {ac}
                </span>
              ))}
              {s.timeframes.map(tf => (
                <span
                  key={tf}
                  className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] font-medium"
                >
                  {tf}
                </span>
              ))}
              {s.trading_style && (
                <span className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] font-medium capitalize">
                  {s.trading_style}
                </span>
              )}
              {s.risk_approach && (
                <span className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] font-medium capitalize">
                  {s.risk_approach} risk
                </span>
              )}
            </div>
          </div>

          {/* Performance */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
              Live Performance ({s.days_live} days tracked)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <PerfStat
                label="Win Rate"
                value={s.win_rate != null ? `${s.win_rate.toFixed(1)}%` : '—'}
              />
              <PerfStat
                label="Avg R:R"
                value={s.avg_rr != null ? `1:${s.avg_rr.toFixed(2)}` : '—'}
              />
              <PerfStat
                label="Mo. Return"
                value={s.monthly_return_avg != null
                  ? `${s.monthly_return_avg >= 0 ? '+' : ''}${s.monthly_return_avg.toFixed(1)}%`
                  : '—'}
                tone={s.monthly_return_avg != null && s.monthly_return_avg >= 0 ? 'green' : 'red'}
              />
              <PerfStat
                label="Max DD"
                value={s.max_drawdown != null ? `${s.max_drawdown.toFixed(1)}%` : '—'}
                tone="red"
              />
              <PerfStat
                label="Sharpe Ratio"
                value={s.sharpe_ratio != null ? s.sharpe_ratio.toFixed(2) : '—'}
              />
              <PerfStat
                label="Total Signals"
                value={s.total_signals.toLocaleString()}
              />
              <PerfStat
                label="Subscribers"
                value={s.subscribers_count.toLocaleString()}
              />
              <PerfStat
                label="Copy Followers"
                value={s.copy_followers_count.toLocaleString()}
              />
            </div>
          </div>

          {/* Description */}
          {s.description && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                About this strategy
              </h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.description}</p>
            </div>
          )}

          {/* Reviews */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
                Reviews
              </h2>
              {s.rating_count > 0 && (
                <span className="text-sm">
                  <span className="text-amber-300 font-bold">
                    ★ {s.rating_avg?.toFixed(1) ?? '—'}
                  </span>
                  <span className="text-muted-foreground ml-1">
                    ({s.rating_count} reviews)
                  </span>
                </span>
              )}
            </div>

            <div className="mb-4">
              <ReviewForm strategyId={s.id} canReview={canReview} />
            </div>

            {!reviews || reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No reviews yet. Be the first to subscribe and share your experience.
              </p>
            ) : (
              <div className="space-y-3">
                {reviews.map((r: any) => (
                  <ReviewItem key={r.id} review={r} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — Subscribe + Copy */}
        <div className="space-y-3">
          {isOwnCreator ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-bold mb-2">Your Strategy</h3>
              <p className="text-xs text-muted-foreground mb-4">
                You&apos;re the creator. Status:{' '}
                <span className="capitalize text-foreground">{s.status}</span>
              </p>
              <a
                href={`/dashboard/strategies/${s.slug}/edit`}
                className="block w-full text-center rounded-lg border border-border py-2 text-xs font-semibold hover:border-primary/60 transition-colors mb-2"
              >
                Edit Strategy
              </a>
              {s.status === 'draft' && (
                <form action={`/api/social/strategies/${s.id}/publish`} method="POST">
                  <button
                    type="submit"
                    className="btn-premium w-full !text-xs !py-2"
                  >
                    Publish
                  </button>
                </form>
              )}
            </div>
          ) : (
            <SubscribeStrategyCard
              strategy={s}
              existingSubscription={mySub ?? null}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function PerfStat({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'red'
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-lg font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}

function ReviewItem({ review }: { review: any }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-amber-300 text-sm">
            {'★'.repeat(review.rating)}
            <span className="text-muted-foreground/40">
              {'★'.repeat(5 - review.rating)}
            </span>
          </span>
          {review.is_verified_sub && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
              ✓ Verified Sub
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          @{review.profiles?.public_handle ?? 'anon'}
        </span>
      </div>
      {review.title && <p className="font-semibold text-sm mb-1">{review.title}</p>}
      {review.body  && <p className="text-xs text-muted-foreground">{review.body}</p>}
    </div>
  )
}
