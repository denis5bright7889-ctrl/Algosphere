/**
 * GET /api/admin/auto-live-status
 *
 * One-shot status view of the Auto-Live ecosystem:
 *   • Signal factory health (latest run + 24h totals)
 *   • Market feed status per provider
 *   • Alert queue summary (pending / dispatched / failed)
 *   • Recovery log summary (24h activity)
 *
 * Admin-only. Read-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const db = svc()
  const since24h = new Date(Date.now() - 86_400_000).toISOString()

  const [factory, market, queueSummary, pendingAlerts, recovery24h] = await Promise.all([
    db.from('signal_factory_runs')
      .select('id, started_at, finished_at, signals_ingested, signals_attempted, outcome')
      .order('started_at', { ascending: false }).limit(10),
    db.from('market_feed_status')
      .select('provider, asset_class, state, consecutive_failures, last_success_at, last_failure_at, last_error, total_requests, total_failures'),
    db.from('alert_queue').select('status'),
    db.from('alert_queue')
      .select('kind, severity, title, created_at, dedupe_key')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(20),
    db.from('recovery_logs')
      .select('problem_kind, outcome')
      .gte('detected_at', since24h),
  ])

  const queueRows = (queueSummary.data ?? []) as Array<{ status: string }>
  const queueCounts = { pending: 0, dispatched: 0, failed: 0, suppressed: 0 }
  for (const r of queueRows) {
    queueCounts[r.status as keyof typeof queueCounts] = (queueCounts[r.status as keyof typeof queueCounts] ?? 0) + 1
  }

  const recoveryRows = (recovery24h.data ?? []) as Array<{ problem_kind: string; outcome: string }>
  const recoveryByKind = new Map<string, { recovered: number; failed: number }>()
  for (const r of recoveryRows) {
    const bucket = recoveryByKind.get(r.problem_kind) ?? { recovered: 0, failed: 0 }
    if (r.outcome === 'recovered') bucket.recovered++
    else if (r.outcome === 'failed') bucket.failed++
    recoveryByKind.set(r.problem_kind, bucket)
  }

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    signal_factory: {
      recent_runs: factory.data ?? [],
    },
    market_feed_providers: market.data ?? [],
    alerts: {
      counts: queueCounts,
      pending_preview: pendingAlerts.data ?? [],
    },
    recovery_24h: Array.from(recoveryByKind.entries()).map(([kind, v]) => ({ kind, ...v })),
    endpoints: {
      auto_signals:    'GET /api/cron/auto-signals',
      auto_live:       'GET /api/cron/auto-live (detect+dispatch+recovery)',
      manual_dispatch: 'POST /api/admin/alerts-dispatch',
    },
  })
}
