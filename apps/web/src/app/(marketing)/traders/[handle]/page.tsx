import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Flame, Activity, AlertCircle } from 'lucide-react'
import Logo from '@/components/brand/Logo'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import {
  verificationBadge,
  riskBadge,
  formatRatio,
  formatScore,
  type TraderProfile,
  type TraderScores,
  type VerificationTier,
} from '@/lib/leaderboard'
import FollowButton from '@/components/social/FollowButton'
import CopyFilterBadge from '@/components/social/CopyFilterBadge'
import ProgressBar from '@/components/ui/ProgressBar'

interface Props {
  params: Promise<{ handle: string }>
}

export async function generateMetadata({ params }: Props) {
  const { handle } = await params
  return {
    title:       `${handle} — Verified Trader · AlgoSphere Quant`,
    description: `Verified, journal-backed performance for @${handle}.`,
  }
}

export const revalidate = 120

export default async function TraderProfilePage({ params }: Props) {
  const { handle } = await params
  const supabase   = await createClient()

  // 1. Resolve handle → user_id + profile basics
  const { data: profileLookup } = await supabase
    .from('profiles')
    .select('id, public_handle, bio, created_at')
    .ilike('public_handle', handle)
    .eq('public_profile', true)
    .single()

  if (!profileLookup) notFound()

  // 2. Parallel fetches
  const [
    { data: profileData },
    { data: scoresData },
    { data: verifData },
    { data: { user } },
  ] = await Promise.all([
    supabase.rpc('trader_profile',  { p_handle: handle }),
    supabase.from('trader_scores').select('*').eq('user_id', profileLookup.id).single(),
    supabase.from('trader_verifications').select('tier').eq('user_id', profileLookup.id).single(),
    supabase.auth.getUser(),
  ])

  const profile = (profileData?.[0] ?? null) as TraderProfile | null
  const scores  = (scoresData ?? null)         as TraderScores | null
  const tier    = (verifData?.tier ?? 'none')  as VerificationTier
  if (!profile) notFound()

  // 3. Check if current user is following
  let isFollowing = false
  if (user && user.id !== profileLookup.id) {
    const { data } = await supabase.rpc('is_following', { p_leader_id: profileLookup.id })
    isFollowing = data ?? false
  }
  const isOwnProfile = user?.id === profileLookup.id

  const badge = verificationBadge(tier)
  const risk  = riskBadge(scores?.risk_label ?? 'medium')

  // Sample-size gate. With zero trades there's nothing to display
  // honestly — we replace the stat grid + 9-factor breakdown with an
  // empty-state panel. With a small number of trades the panel is
  // shown but caveated; the composite score is statistically thin
  // until the sample stabilises.
  const MIN_RELIABLE_SAMPLE = 5
  const hasTrades   = profile.trades > 0
  const lowSample   = hasTrades && profile.trades < MIN_RELIABLE_SAMPLE

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a href="/traders" className="text-sm text-muted-foreground hover:text-foreground">
            ← Leaderboard
          </a>
          <a href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Logo size="sm" alt="" />
            <span><span className="text-gradient">AlgoSphere</span> Quant</span>
          </a>
        </div>
      </header>

      <section className="relative mx-auto max-w-5xl px-4 py-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh opacity-40 pointer-events-none" aria-hidden />

        {/* ── Profile Header Card ─────────────────────────── */}
        <div className="relative rounded-2xl border border-border bg-card p-6 sm:p-8 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {badge && (
                  <span className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
                    badge.cls,
                  )}>
                    <badge.icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                    {badge.label} Trader
                  </span>
                )}
                {scores?.composite_rank && scores.composite_rank <= 10 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
                    <Flame className="h-3 w-3" strokeWidth={2} aria-hidden />
                    Top 10
                  </span>
                )}
              </div>

              <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
                <span className="text-gradient">@{profile.handle}</span>
              </h1>
              {profile.bio && (
                <p className="mt-2 text-muted-foreground max-w-xl text-sm">{profile.bio}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Member since {formatDate(profile.member_since)}
                {scores?.composite_rank && (
                  <> · Rank <span className="text-foreground font-semibold">
                    #{scores.composite_rank}
                  </span> overall</>
                )}
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-2">
              {isOwnProfile ? (
                <a
                  href="/profile/edit"
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold hover:border-primary/60 hover:text-primary transition-colors"
                >
                  Edit Profile
                </a>
              ) : (
                <>
                  <FollowButton
                    leaderId={profileLookup.id}
                    leaderHandle={profile.handle}
                    initialFollowing={isFollowing}
                    initialFollowers={scores?.followers_count ?? 0}
                  />
                </>
              )}
            </div>
          </div>

          {/* ── Stat Pills ─────────────────────────────────
              Only rendered when the trader has at least one journal
              entry. Otherwise we drop into an honest 'no track record'
              panel below — never display 0% / +$0 / Composite 50 for
              a profile that hasn't traded yet. */}
          {hasTrades && (
            <>
              {lowSample && (
                <p className="mt-5 inline-flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-1.5 text-[11px] text-amber-200/90">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  Limited sample — {profile.trades} trade{profile.trades === 1 ? '' : 's'} so far.
                  Composite Score and ratios stabilise after roughly {MIN_RELIABLE_SAMPLE}+.
                </p>
              )}
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <Stat label="Composite Score"
                      value={scores ? formatScore(scores.composite_score) : '—'}
                      tone={scores ? 'gold' : 'plain'} />
                <Stat label="Win Rate"
                      value={profile.win_rate != null ? `${profile.win_rate}%` : '—'}
                      tone="plain" />
                <Stat label="Net P&L"
                      value={`${profile.total_pnl >= 0 ? '+' : ''}$${profile.total_pnl.toLocaleString()}`}
                      tone={profile.total_pnl >= 0 ? 'green' : 'red'} />
                <Stat label="Sharpe"
                      value={formatRatio(scores?.sharpe_ratio ?? null)}
                      tone="plain" />
                <Stat label="Max DD"
                      value={scores?.max_drawdown_pct != null ? `${scores.max_drawdown_pct.toFixed(1)}%` : '—'}
                      // Red only when there's an actual drawdown to surface.
                      tone={scores?.max_drawdown_pct != null && scores.max_drawdown_pct > 0 ? 'red' : 'plain'} />
                <Stat label="Trades"
                      value={String(profile.trades)}
                      tone="plain" />
              </div>
            </>
          )}

          {!hasTrades && (
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/10 p-4 text-xs text-muted-foreground">
              <Activity className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/60" strokeWidth={1.75} aria-hidden />
              <p>
                <span className="font-semibold text-foreground">No track record yet.</span>{' '}
                This profile is registered but hasn&apos;t logged any trades. Win rate, P&amp;L,
                Sharpe, drawdown and the 9-factor composite score will appear here once the
                trade journal has at least one entry. No placeholder metrics are shown.
              </p>
            </div>
          )}

          {/* ── Social Stats ────────────────────────────── */}
          {scores && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{scores.followers_count.toLocaleString()}</strong> followers</span>
              <span>·</span>
              <span><strong className="text-foreground">{scores.copy_followers_count.toLocaleString()}</strong> copy followers</span>
              {scores.total_aum_usd > 0 && (
                <>
                  <span>·</span>
                  <span><strong className="text-foreground">${scores.total_aum_usd.toLocaleString()}</strong> AUM</span>
                </>
              )}
              <span>·</span>
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold capitalize',
                risk.cls,
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full', risk.dot)} />
                {scores.risk_label} risk
              </span>
            </div>
          )}
        </div>

        {/* ── Copy-Filter AI Verdict ─────────────────────── */}
        <div className="mt-6">
          <CopyFilterBadge userId={profileLookup.id} />
        </div>

        {/* ── Score Breakdown ───────────────────────────────
            Same sample-size gate as the stat grid — the 9-factor
            composite is meaningless without trades to score against. */}
        {scores && hasTrades && (
          <div className="relative mt-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
              Score Breakdown — 9-Factor Composite
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <ScoreBar label="Win Rate"      pct={(scores as any).score_win_rate}     weight={25} />
              <ScoreBar label="Risk-Adjusted" pct={(scores as any).score_risk_adj}     weight={20} />
              <ScoreBar label="Consistency"   pct={(scores as any).score_consistency}  weight={15} />
              <ScoreBar label="Drawdown"      pct={(scores as any).score_drawdown}     weight={15} />
              <ScoreBar label="Sample Size"   pct={(scores as any).score_sample_size}  weight={10} />
              <ScoreBar label="Recency"       pct={(scores as any).score_recency}      weight={5} />
              <ScoreBar label="Diversity"     pct={(scores as any).score_diversity}    weight={5} />
              <ScoreBar label="Copy Follower PnL" pct={(scores as any).score_follower_pnl} weight={3} />
              <ScoreBar label="Verification"  pct={(scores as any).score_verification} weight={2} />
            </div>
          </div>
        )}

        {/* ── Privacy notice ─────────────────────────────── */}
        <div className="relative mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-6 text-center">
          <p className="text-xs text-muted-foreground">
            All stats aggregated from a real trade journal — no self-reported figures,
            no individual trades exposed.
          </p>
          {!isOwnProfile && (
            <a href="/signup" className="btn-premium mt-3 inline-block !text-sm">
              Build your own verified track record
            </a>
          )}
        </div>
      </section>
    </main>
  )
}

// ─── Sub-components ─────────────────────────────────────────

function Stat({ label, value, tone }: {
  label: string
  value: string
  tone:  'gold' | 'green' | 'red' | 'plain'
}) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-lg font-bold tabular-nums',
        tone === 'gold'  && 'text-amber-300 glow-text-gold',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}

function ScoreBar({ label, pct, weight }: { label: string; pct: number; weight: number }) {
  const safePct = Math.max(0, Math.min(100, pct ?? 0))
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">
          {label}
          <span className="ml-1 text-[10px] opacity-60">({weight}%)</span>
        </span>
        <span className="font-bold tabular-nums">{safePct.toFixed(0)}</span>
      </div>
      <ProgressBar
        value={safePct}
        barClassName="bg-gradient-to-r from-amber-500/60 to-amber-300"
      />
    </div>
  )
}
