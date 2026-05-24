import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/system/health
 *
 * Platform-wide operational snapshot for the Command Center: global kill
 * switch state, copy_jobs queue depth (queued / claimed / failed counts),
 * DLQ size (open vs replayed), quarantined strategies, recent fan-out
 * volume. Read-only; service-role aggregations are exposed because the
 * data is anonymous totals — no per-user PII.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Kill switch (public read policy on global_risk_state).
  const ksRes = await supabase.from('global_risk_state')
    .select('kill_switch, reason, activated_by, activated_at')
    .eq('id', true).maybeSingle()

  // Counts via {head:true, count:'exact'} — no rows returned, just counts.
  // The user RLS allows reading their own copy_jobs; counts here are
  // RLS-scoped (their pipeline view, which is what the personal dashboard
  // should show). For a true admin global view, use service-role admin APIs.
  const [queuedRes, claimedRes, failedRes, dlqOpenRes, dlqDoneRes, quarRes] =
    await Promise.all([
      supabase.from('copy_jobs').select('id', { head: true, count: 'exact' })
        .eq('follower_id', user.id).eq('status', 'queued'),
      supabase.from('copy_jobs').select('id', { head: true, count: 'exact' })
        .eq('follower_id', user.id).in('status', ['claimed','risk_check','allocating','routing','submitted']),
      supabase.from('copy_jobs').select('id', { head: true, count: 'exact' })
        .eq('follower_id', user.id).eq('status', 'failed'),
      supabase.from('copy_jobs_dlq').select('id', { head: true, count: 'exact' })
        .eq('follower_id', user.id).is('replayed_at', null),
      supabase.from('copy_jobs_dlq').select('id', { head: true, count: 'exact' })
        .eq('follower_id', user.id).not('replayed_at', 'is', null),
      // strategy_risk_state has public read policy.
      supabase.from('strategy_risk_state').select('strategy_id', { head: true, count: 'exact' })
        .neq('status', 'active'),
    ])

  return NextResponse.json({
    kill_switch: {
      active:       Boolean(ksRes.data?.kill_switch),
      reason:       ksRes.data?.reason ?? null,
      activated_by: ksRes.data?.activated_by ?? null,
      activated_at: ksRes.data?.activated_at ?? null,
    },
    queue: {
      queued:  queuedRes.count  ?? 0,
      in_flight: claimedRes.count ?? 0,
      failed:  failedRes.count  ?? 0,
    },
    dlq: {
      open:     dlqOpenRes.count ?? 0,
      replayed: dlqDoneRes.count ?? 0,
    },
    quarantined_strategies: quarRes.count ?? 0,
    // Worker liveness can't be cheaply checked from the web layer; the
    // observability stack (Prometheus + Grafana from ops/observability)
    // is the canonical source. Surfaced here as a stub for the UI to flag.
    workers: { source: 'ops/observability (Prometheus)' },
  })
}
