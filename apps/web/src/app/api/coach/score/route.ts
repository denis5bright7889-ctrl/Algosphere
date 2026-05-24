import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/coach/score
 *
 * The user's AI Trading Coach scorecard: discipline score, the behavioral
 * metrics behind it, and any open (unacknowledged) alerts. coach_state is
 * upserted by the coach worker every ~5 min from journal_entries; absence
 * of a row means "not enough trades yet to score" (the worker only scores
 * users with >= 5 realized trades).
 *
 * Always 200; { state: null, alerts: [] } when there's nothing to show.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [stateRes, alertsRes] = await Promise.all([
    supabase
      .from('coach_state')
      .select(
        'discipline_score, win_rate, win_rate_after_losses, ' +
        'current_loss_streak, max_loss_streak, revenge_events, ' +
        'oversize_events, trades_per_active_hour, sizing_cv, ' +
        'trades, window_days, computed_at',
      )
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('coach_alerts')
      .select('id, kind, severity, title, payload, created_at')
      .eq('user_id', user.id)
      .eq('acknowledged', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (stateRes.error)  return NextResponse.json({ error: stateRes.error.message },  { status: 500 })
  if (alertsRes.error) return NextResponse.json({ error: alertsRes.error.message }, { status: 500 })

  return NextResponse.json({
    state:  stateRes.data ?? null,
    alerts: alertsRes.data ?? [],
  })
}
