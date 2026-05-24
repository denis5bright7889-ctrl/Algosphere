import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/journal/summary
 *
 * Tradezella-grade performance scorecard for the current user, computed by
 * the coach worker from realized journal_entries (same pass as coach_state).
 * Returns { row: null } when not yet scored (fewer than 1 realized trade in
 * the window).
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('journal_analytics')
    .select(
      'trades, win_rate, profit_factor, expectancy, gross_profit, gross_loss, ' +
      'avg_win, avg_loss, reward_risk, net_pnl, max_drawdown, ' +
      'best_pair, worst_pair, best_session, ' +
      'by_session, by_pair, by_tag, by_hour, window_days, computed_at',
    )
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row: data })
}
