/**
 * GET /api/dashboard — RLS-scoped dashboard snapshot as JSON.
 *
 * Sibling endpoint for the realtime widgets on kept pages
 * (ActionDock, LiveTicker, useDashboard) — no full page reload needed.
 *
 * Refocus R7: copy-engine telemetry (copy_health, copy_jobs,
 * copy_reconciliation) removed alongside the deleted copy-engine. The
 * autotrade observability surface from PR #59B (held) will rebuild
 * any equivalent fields once that branch lands. For now we expose
 * kill-switch, risk exposure, limits, and coach state only.
 *
 * RLS-scoped: every read goes through the caller's JWT.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'

type Kill     = Database['public']['Tables']['global_risk_state']['Row']
type Exposure = Database['public']['Tables']['portfolio_exposure']['Row']
type Limits   = Database['public']['Tables']['risk_limits']['Row']
type Coach    = Database['public']['Tables']['coach_state']['Row']
type Alert    = Database['public']['Tables']['coach_alerts']['Row']

export const dynamic = 'force-dynamic'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [killRes, expRes, limRes, coachRes, alertsRes] = await Promise.all([
    supabase.from('global_risk_state').select('kill_switch, reason, activated_at').eq('id', true).maybeSingle(),
    supabase.from('portfolio_exposure')
      .select('total_notional, open_positions, largest_concentration_pct, ' +
              'daily_realized_pnl, cumulative_realized_pnl, drawdown_usd, ' +
              'by_direction, updated_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('risk_limits')
      .select('enabled, max_total_exposure_usd, max_symbol_concentration_pct, ' +
              'daily_loss_cap_usd, max_drawdown_usd, max_open_positions')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('coach_state')
      .select('discipline_score, win_rate, current_loss_streak, ' +
              'revenge_events, oversize_events, trades, computed_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('coach_alerts')
      .select('id, kind, severity, title, created_at')
      .eq('user_id', user.id).eq('acknowledged', false)
      .order('created_at', { ascending: false }).limit(8),
  ])

  const kill   = (killRes.data   ?? null) as Kill | null
  const exp    = (expRes.data    ?? null) as Exposure | null
  const lim    = (limRes.data    ?? null) as Limits | null
  const coach  = (coachRes.data  ?? null) as Coach | null
  const alerts = (alertsRes.data ?? []) as unknown as Alert[]

  const totalNotional = num(exp?.total_notional)
  const maxExposure   = lim?.max_total_exposure_usd ? num(lim.max_total_exposure_usd) : null
  const maxDrawdown   = lim?.max_drawdown_usd ? num(lim.max_drawdown_usd) : null
  const drawdownUsd   = num(exp?.drawdown_usd)

  return NextResponse.json(
    {
      kill: {
        active: kill?.kill_switch ?? false,
        reason: kill?.reason ?? null,
        activated_at: kill?.activated_at ?? null,
      },
      kpis: {
        total_notional:    totalNotional,
        exposure_cap_usd:  maxExposure,
        exposure_cap_pct:  maxExposure ? Math.min(100, Math.round((100 * totalNotional) / maxExposure)) : null,
        open_positions:    num(exp?.open_positions),
        max_open_positions: lim?.max_open_positions ?? null,
        daily_realized_pnl: num(exp?.daily_realized_pnl),
        daily_loss_cap_usd: lim?.daily_loss_cap_usd ? num(lim.daily_loss_cap_usd) : null,
        cumulative_realized_pnl: num(exp?.cumulative_realized_pnl),
        drawdown_usd:      drawdownUsd,
        max_drawdown_usd:  maxDrawdown,
        drawdown_cap_pct:  maxDrawdown ? Math.min(100, Math.round((100 * drawdownUsd) / maxDrawdown)) : null,
        concentration_pct: exp?.largest_concentration_pct ?? null,
        max_concentration_pct: lim?.max_symbol_concentration_pct ?? null,
        discipline_score:  coach?.discipline_score ?? null,
        win_rate:          coach?.win_rate ?? null,
        loss_streak:       coach?.current_loss_streak ?? 0,
        trades:            coach?.trades ?? 0,
      },
      coach_alerts: alerts,
      generated_at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
