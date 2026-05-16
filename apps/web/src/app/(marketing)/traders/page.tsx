import { createClient } from '@/lib/supabase/server'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import {
  rankMedal,
  verificationBadge,
  riskBadge,
  rankChangeLabel,
  formatPct,
  formatRatio,
  formatScore,
  type LeaderboardRowV2,
} from '@/lib/leaderboard'

export const metadata = {
  title: 'Trader Leaderboard — AlgoSphere Quant',
  description:
    'Ranked by a 9-factor composite score. Verified, journal-backed — no self-reported numbers.',
}

export const revalidate = 120

const CATEGORIES = [
  { key: 'overall',  label: 'Overall'      },
  { key: 'monthly',  label: 'This Month'   },
  { key: 'forex',    label: 'Forex'        },
  { key: 'crypto',   label: 'Crypto'       },
  { key: 'rising',   label: 'Rising Stars' },
  { key: 'elite',    label: 'Elite Only'   },
] as const

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>
}) {
  const { cat = 'overall' } = await searchParams
  const supabase = await createClient()

  // Try v2 (trader_scores-backed); fall back to v1 if not yet populated
  const { data: v2data } = await supabase.rpc('trader_leaderboard_v2', {
    p_category: cat,
    p_limit:    50,
    p_offset:   0,
  })
  const rows = (v2data ?? []) as LeaderboardRowV2[]

  return (
    <main className="min-h-screen">
      {/* ── Header ─────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Logo size="sm" alt="" priority />
            <span><span className="text-gradient">AlgoSphere</span> Quant</span>
          </a>
          <a href="/signup" className="btn-premium !py-2 !text-xs">Start free trial</a>
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl px-4 py-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh opacity-40 pointer-events-none" aria-hidden />

        {/* ── Hero ────────────────────────────────────── */}
        <div className="relative text-center mb-8">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase mb-4">
            9-Factor Composite Score · Journal-Verified
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Trader <span className="text-gradient">Leaderboard</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl mx-auto">
            Ranked by win rate, Sharpe ratio, consistency, drawdown, diversity, and more.
            All stats aggregated from real trade journals — no self-reporting.
          </p>
        </div>

        {/* ── Category tabs ───────────────────────────── */}
        <div className="relative flex gap-1 flex-wrap justify-center mb-6">
          {CATEGORIES.map(c => (
            <a
              key={c.key}
              href={`/traders?cat=${c.key}`}
              className={cn(
                'rounded-full border px-4 py-1.5 text-xs font-medium transition-colors',
                cat === c.key
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80',
              )}
            >
              {c.label}
            </a>
          ))}
        </div>

        {/* ── Table ───────────────────────────────────── */}
        {rows.length === 0 ? (
          <div className="relative rounded-2xl border border-dashed border-border p-14 text-center">
            <p className="text-muted-foreground text-sm">
              No ranked traders yet. Log trades → publish your profile in Settings.
            </p>
            <a href="/signup" className="btn-premium mt-5 inline-block !text-sm">Get started</a>
          </div>
        ) : (
          <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium w-12">#</th>
                    <th className="px-4 py-3 font-medium">Trader</th>
                    <th className="px-4 py-3 font-medium text-right">Score</th>
                    <th className="px-4 py-3 font-medium text-right">Win Rate</th>
                    <th className="px-4 py-3 font-medium text-right">Mo. Return</th>
                    <th className="px-4 py-3 font-medium text-right">Sharpe</th>
                    <th className="px-4 py-3 font-medium text-right">Max DD</th>
                    <th className="px-4 py-3 font-medium text-right">Risk</th>
                    <th className="px-4 py-3 font-medium text-right">Followers</th>
                    <th className="px-4 py-3 font-medium text-right">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const badge   = verificationBadge(r.verification_tier)
                    const risk    = riskBadge(r.risk_label)
                    const rankChg = rankChangeLabel(r.rank_change_24h)
                    const isTop3  = i < 3

                    return (
                      <tr
                        key={r.user_id}
                        className={cn(
                          'border-b border-border/50 last:border-0 transition-colors hover:bg-muted/20',
                          isTop3 && 'bg-amber-500/[0.03]',
                        )}
                      >
                        {/* Rank */}
                        <td className="px-4 py-3 tabular-nums font-bold text-base">
                          {rankMedal(i)}
                          {rankChg && (
                            <span className={cn('ml-1 text-[10px]', rankChg.cls)}>
                              {rankChg.label}
                            </span>
                          )}
                        </td>

                        {/* Trader */}
                        <td className="px-4 py-3">
                          <a
                            href={`/traders/${r.handle}`}
                            className="group flex items-start gap-2"
                          >
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold group-hover:text-amber-300 transition-colors">
                                  @{r.handle}
                                </span>
                                {badge && (
                                  <span className={cn(
                                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                                    badge.cls,
                                  )}>
                                    {badge.icon} {badge.label}
                                  </span>
                                )}
                              </div>
                              {r.bio && (
                                <p className="text-[11px] text-muted-foreground truncate max-w-[240px] mt-0.5">
                                  {r.bio}
                                </p>
                              )}
                            </div>
                          </a>
                        </td>

                        {/* Score */}
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-300">
                          {formatScore(r.composite_score)}
                        </td>

                        {/* Win Rate */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.win_rate != null ? `${r.win_rate.toFixed(1)}%` : '—'}
                        </td>

                        {/* Monthly Return */}
                        <td className={cn(
                          'px-4 py-3 text-right tabular-nums font-medium',
                          r.monthly_return != null && r.monthly_return >= 0
                            ? 'text-emerald-400' : 'text-rose-400',
                        )}>
                          {formatPct(r.monthly_return)}
                        </td>

                        {/* Sharpe */}
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {formatRatio(r.sharpe_ratio)}
                        </td>

                        {/* Max DD */}
                        <td className="px-4 py-3 text-right tabular-nums text-rose-400">
                          {r.max_drawdown != null ? `${r.max_drawdown.toFixed(1)}%` : '—'}
                        </td>

                        {/* Risk */}
                        <td className="px-4 py-3 text-right">
                          <span className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize',
                            risk.cls,
                          )}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', risk.dot)} />
                            {r.risk_label}
                          </span>
                        </td>

                        {/* Followers */}
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {r.followers_count.toLocaleString()}
                        </td>

                        {/* CTA */}
                        <td className="px-4 py-3 text-right">
                          <a
                            href={`/traders/${r.handle}`}
                            className="rounded-lg border border-border px-3 py-1 text-[11px] font-medium hover:border-primary/60 hover:text-primary transition-colors"
                          >
                            View
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-border/50 text-[11px] text-muted-foreground">
              Score uses a 9-factor composite (win rate, Sharpe, consistency, drawdown, sample
              size, recency, diversity, copy PnL, verification). Min 5 trades to rank.
              Refreshed every hour.
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
