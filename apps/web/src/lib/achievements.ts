/**
 * Achievement engine — pure computation over journal + trader_scores aggregates.
 * Returns badge IDs the user has unlocked.
 */

export const ACHIEVEMENTS = {
  first_trade:       { icon: '🌱', label: 'First Trade',         tier: 'bronze' },
  ten_trades:        { icon: '📊', label: '10 Trades Logged',    tier: 'bronze' },
  fifty_trades:      { icon: '📈', label: 'Half-Century',         tier: 'silver' },
  hundred_trades:    { icon: '🎯', label: 'Century Club',         tier: 'gold'   },
  five_streak:       { icon: '🔥', label: '5-Win Streak',         tier: 'silver' },
  ten_streak:        { icon: '⚡', label: '10-Win Streak',        tier: 'gold'   },
  consistent_60:     { icon: '💎', label: 'Consistent 60%+ WR',   tier: 'gold'   },
  risk_master:       { icon: '🛡️', label: 'Risk Master (<5% DD)', tier: 'gold'   },
  published_strat:   { icon: '🚀', label: 'Strategy Published',   tier: 'silver' },
  verified_trader:   { icon: '✅', label: 'Verified Trader',      tier: 'gold'   },
  elite_trader:      { icon: '🏆', label: 'Elite Trader',         tier: 'elite'  },
  follower_100:      { icon: '⭐', label: '100 Followers',        tier: 'silver' },
  follower_1000:     { icon: '🌟', label: '1,000 Followers',      tier: 'gold'   },
  copy_aum_10k:      { icon: '💰', label: '$10k Copy AUM',        tier: 'silver' },
  zero_violations:   { icon: '🧘', label: 'Zero Rule Violations', tier: 'gold'   },
} as const

export type AchievementKey = keyof typeof ACHIEVEMENTS

export const TIER_CLS: Record<string, string> = {
  bronze: 'border-amber-700/40 bg-amber-700/10  text-amber-400',
  silver: 'border-slate-400/40 bg-slate-400/10  text-slate-300',
  gold:   'border-amber-500/50 bg-amber-500/10  text-amber-300',
  elite:  'border-amber-300/60 bg-amber-300/15  text-amber-200',
}

interface Inputs {
  totalTrades:        number
  winRate:            number       // 0-1
  maxDrawdownPct:     number       // 0-1
  longestWinStreak:   number
  publishedStrategies: number
  followers:          number
  copyAumUsd:         number
  ruleViolations:     number
  verificationTier:   'none' | 'basic' | 'verified' | 'elite'
}

export function computeAchievements(inp: Inputs): AchievementKey[] {
  const out: AchievementKey[] = []
  if (inp.totalTrades >= 1)    out.push('first_trade')
  if (inp.totalTrades >= 10)   out.push('ten_trades')
  if (inp.totalTrades >= 50)   out.push('fifty_trades')
  if (inp.totalTrades >= 100)  out.push('hundred_trades')
  if (inp.longestWinStreak >= 5)  out.push('five_streak')
  if (inp.longestWinStreak >= 10) out.push('ten_streak')
  if (inp.totalTrades >= 30 && inp.winRate >= 0.60) out.push('consistent_60')
  if (inp.totalTrades >= 30 && inp.maxDrawdownPct <= 0.05) out.push('risk_master')
  if (inp.publishedStrategies >= 1) out.push('published_strat')
  if (inp.verificationTier === 'verified' || inp.verificationTier === 'elite') {
    out.push('verified_trader')
  }
  if (inp.verificationTier === 'elite') out.push('elite_trader')
  if (inp.followers >= 100)  out.push('follower_100')
  if (inp.followers >= 1000) out.push('follower_1000')
  if (inp.copyAumUsd >= 10_000) out.push('copy_aum_10k')
  if (inp.totalTrades >= 50 && inp.ruleViolations === 0) out.push('zero_violations')
  return out
}
