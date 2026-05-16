import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import {
  ACHIEVEMENTS,
  TIER_CLS,
  computeAchievements,
  type AchievementKey,
} from '@/lib/achievements'

export const metadata = { title: 'Achievements — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function AchievementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Aggregate inputs
  const [
    { data: scores },
    { data: trades },
    { count: publishedCount },
    { data: verif },
  ] = await Promise.all([
    supabase.from('trader_scores')
      .select('total_trades, win_rate, max_drawdown_pct, followers_count, total_aum_usd')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('journal_entries')
      .select('pnl, rule_violation')
      .eq('user_id', user.id),
    supabase.from('published_strategies')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', user.id).eq('status', 'active'),
    supabase.from('trader_verifications')
      .select('tier').eq('user_id', user.id).maybeSingle(),
  ])

  // Compute longest win streak from trade pnls
  let longestStreak = 0, current = 0
  for (const t of trades ?? []) {
    if (Number(t.pnl ?? 0) > 0) { current += 1; longestStreak = Math.max(longestStreak, current) }
    else current = 0
  }
  const ruleViolations = (trades ?? []).filter(t => t.rule_violation === true).length

  const unlocked = new Set<AchievementKey>(computeAchievements({
    totalTrades:         scores?.total_trades ?? 0,
    winRate:             (scores?.win_rate ?? 0) / 100,
    maxDrawdownPct:      (scores?.max_drawdown_pct ?? 0) / 100,
    longestWinStreak:    longestStreak,
    publishedStrategies: publishedCount ?? 0,
    followers:           scores?.followers_count ?? 0,
    copyAumUsd:          Number(scores?.total_aum_usd ?? 0),
    ruleViolations,
    verificationTier:    (verif?.tier ?? 'none') as 'none' | 'basic' | 'verified' | 'elite',
  }))

  const all = Object.keys(ACHIEVEMENTS) as AchievementKey[]

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient">Achievements</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {unlocked.size} of {all.length} unlocked.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Mastery</p>
          <p className="text-2xl font-bold tabular-nums text-amber-300 glow-text-gold mt-1">
            {Math.round(unlocked.size / all.length * 100)}%
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {all.map(key => {
          const a = ACHIEVEMENTS[key]
          const has = unlocked.has(key)
          return (
            <div
              key={key}
              className={cn(
                'rounded-2xl border p-4 text-center transition-colors',
                has ? TIER_CLS[a.tier] : 'border-border bg-card opacity-40 grayscale',
              )}
            >
              <div className={cn('text-3xl mb-2', !has && 'filter blur-[1px]')}>
                {a.icon}
              </div>
              <p className="text-xs font-bold leading-tight">{a.label}</p>
              <p className="text-[9px] uppercase tracking-wider opacity-70 mt-1">
                {has ? 'Unlocked' : 'Locked'}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
