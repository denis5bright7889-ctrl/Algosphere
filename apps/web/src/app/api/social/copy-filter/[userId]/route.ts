import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { filterTrader } from '@/lib/copy-filter'

// Run the AI copy filter on a trader's cached metrics.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const { userId } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: scores } = await supabase
    .from('trader_scores')
    .select('total_trades, win_rate, sharpe_ratio, max_drawdown_pct, profit_factor, monthly_return_pct, followers_count, copy_followers_count, avg_follower_return')
    .eq('user_id', userId)
    .maybeSingle()

  if (!scores) {
    return NextResponse.json({ error: 'No track record for this trader' }, { status: 404 })
  }

  // Largest-win dominance: from journal aggregate
  const { data: trades } = await supabase
    .from('journal_entries')
    .select('pnl')
    .eq('user_id', userId)
    .not('pnl', 'is', null)

  const pnls = (trades ?? []).map(t => Number(t.pnl ?? 0)).filter(p => p > 0)
  const totalProfit = pnls.reduce((s, p) => s + p, 0)
  const largestWinPct = totalProfit > 0 ? Math.max(0, ...pnls) / totalProfit : 0

  const result = filterTrader({
    totalTrades:            scores.total_trades ?? 0,
    winRate:                (scores.win_rate ?? 0) / 100,
    sharpeRatio:            scores.sharpe_ratio,
    maxDrawdownPct:         (scores.max_drawdown_pct ?? 0) / 100,
    profitFactor:           scores.profit_factor ?? 0,
    monthlyReturnPct:       scores.monthly_return_pct ?? 0,
    largestWinPct,
    followersCount:         scores.followers_count ?? 0,
    copyFollowersAvgReturn: scores.avg_follower_return,
  })

  return NextResponse.json(result)
}
