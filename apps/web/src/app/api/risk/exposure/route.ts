import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/risk/exposure
 *
 * The user's portfolio_exposure snapshot (recomputed by the reconciler) +
 * their risk_limits if set. Powers the risk command center: total notional,
 * by-symbol/direction breakdown, largest concentration %, daily realized
 * PnL, cumulative + peak realized PnL, drawdown_usd. Limits surface so the
 * UI can show "X / Y used" gauges.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [expRes, limRes] = await Promise.all([
    supabase.from('portfolio_exposure')
      .select('total_notional, by_symbol, by_direction, open_positions, ' +
              'largest_concentration_pct, daily_realized_pnl, ' +
              'cumulative_realized_pnl, peak_realized_pnl, drawdown_usd, updated_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('risk_limits')
      .select('enabled, max_total_exposure_usd, max_symbol_concentration_pct, ' +
              'daily_loss_cap_usd, max_drawdown_usd, max_open_positions, updated_at')
      .eq('user_id', user.id).maybeSingle(),
  ])
  if (expRes.error) return NextResponse.json({ error: expRes.error.message }, { status: 500 })
  if (limRes.error) return NextResponse.json({ error: limRes.error.message }, { status: 500 })

  return NextResponse.json({
    exposure: expRes.data ?? null,
    limits:   limRes.data ?? null,
  })
}
