/**
 * GET /api/dashboard — the Command Center snapshot as JSON.
 *
 * This is the missing sibling of the server-rendered /command page: the
 * exact same RLS-scoped aggregate, exposed as a polling/refresh endpoint so
 * the realtime widgets (Phase 3) can update without a full page reload. The
 * /command page comment already anticipated this ("swap the fetch with a
 * useSubscription") — same panels, same data contract, now fetchable.
 *
 * RLS-scoped: every read goes through the caller's JWT, so a user only ever
 * sees their own exposure/health/coach/jobs. The global kill switch is the
 * only shared row. No broker credentials, no engine internals.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'

type Kill     = Database['public']['Tables']['global_risk_state']['Row']
type Exposure = Database['public']['Tables']['portfolio_exposure']['Row']
type Limits   = Database['public']['Tables']['risk_limits']['Row']
type Health   = Database['public']['Tables']['copy_health']['Row']
type Coach    = Database['public']['Tables']['coach_state']['Row']
type Alert    = Database['public']['Tables']['coach_alerts']['Row']
type Recon    = Database['public']['Tables']['copy_reconciliation']['Row']
type Job      = Database['public']['Tables']['copy_jobs']['Row']

export const dynamic = 'force-dynamic'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Same eight reads the /command page runs, plus queue-depth counts — all
  // RLS-scoped to this user (kill switch is the only shared row).
  const [
    killRes, expRes, limRes, healthRes, coachRes, alertsRes, reconRes,
    jobsRes, queuedRes, claimedRes,
  ] = await Promise.all([
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
    supabase.from('copy_health')
      .select('subscription_id, leader_id, fill_rate, p95_lag_ms, ' +
              'desync_open, health_score, health_label, updated_at')
      .eq('follower_id', user.id)
      .order('health_score', { ascending: false, nullsFirst: false }).limit(10),
    supabase.from('coach_state')
      .select('discipline_score, win_rate, current_loss_streak, ' +
              'revenge_events, oversize_events, trades, computed_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('coach_alerts')
      .select('id, kind, severity, title, created_at')
      .eq('user_id', user.id).eq('acknowledged', false)
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('copy_reconciliation')
      .select('id, kind, severity, expected, observed, detected_at')
      .eq('follower_id', user.id).is('resolved_at', null)
      .order('severity', { ascending: false })
      .order('detected_at', { ascending: false }).limit(8),
    supabase.from('copy_jobs')
      .select('id, trace_id, kind, status, computed_lot, risk_reason, ' +
              'last_error, created_at, filled_at')
      .eq('follower_id', user.id)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('copy_jobs').select('id', { head: true, count: 'exact' })
      .eq('follower_id', user.id).eq('status', 'queued'),
    supabase.from('copy_jobs').select('id', { head: true, count: 'exact' })
      .eq('follower_id', user.id).eq('status', 'claimed'),
  ])

  const kill   = (killRes.data   ?? null) as Kill | null
  const exp    = (expRes.data    ?? null) as Exposure | null
  const lim    = (limRes.data    ?? null) as Limits | null
  const health = (healthRes.data ?? []) as unknown as Health[]
  const coach  = (coachRes.data  ?? null) as Coach | null
  const alerts = (alertsRes.data ?? []) as unknown as Alert[]
  const recon  = (reconRes.data  ?? []) as unknown as Recon[]
  const jobs   = (jobsRes.data   ?? []) as unknown as Job[]

  // Derived KPIs — computed once here so every client renders identically
  // and doesn't re-derive caps client-side.
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
        open_desyncs:      recon.length,
        queue_depth:       (queuedRes.count ?? 0) + (claimedRes.count ?? 0),
        queued:            queuedRes.count ?? 0,
        claimed:           claimedRes.count ?? 0,
      },
      copy_health: health,
      coach_alerts: alerts,
      reconciliation: recon,
      recent_jobs: jobs,
      generated_at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
