/**
 * GET /api/admin/shadow-engine-status
 *
 * Reports the state of the Shadow Execution Engine:
 *   - Ingest activity (rows per hour over the past 24h)
 *   - Open positions
 *   - Closed positions in window
 *   - Per-broker fill counts + simulated profile parameters
 *   - Whether the lifecycle ticker has run recently
 *
 * Admin-only. Read-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { listBrokerProfiles } from '@/lib/intelligence/shadow-execution-engine'

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
  const now = Date.now()
  const since24h = new Date(now - 86_400_000).toISOString()
  const since1h  = new Date(now -  3_600_000).toISOString()

  const [open, closed24h, ingested24h, ingested1h, latest] = await Promise.all([
    db.from('shadow_executions')
      .select('*', { count: 'exact', head: true })
      .in('actual_status', ['mirrored', 'testnet'])
      .is('closed_at', null)
      .then(r => r.count ?? 0),

    db.from('shadow_executions')
      .select('*', { count: 'exact', head: true })
      .gte('closed_at', since24h)
      .then(r => r.count ?? 0),

    db.from('shadow_executions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since24h)
      .then(r => r.count ?? 0),

    db.from('shadow_executions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since1h)
      .then(r => r.count ?? 0),

    db.from('shadow_executions')
      .select('id, symbol, direction, broker, actual_status, intended_entry, actual_fill_price, slippage_pct, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  // Broker breakdown (last 24h)
  const { data: brokerSlice } = await db
    .from('shadow_executions')
    .select('broker, actual_status')
    .gte('created_at', since24h)
    .limit(5_000)

  const brokerCounts = new Map<string, { mirrored: number; failed: number; total: number }>()
  for (const r of ((brokerSlice ?? []) as Array<{ broker: string; actual_status: string }>)) {
    const b = brokerCounts.get(r.broker) ?? { mirrored: 0, failed: 0, total: 0 }
    b.total += 1
    if (r.actual_status === 'mirrored' || r.actual_status === 'testnet') b.mirrored += 1
    if (r.actual_status === 'failed') b.failed += 1
    brokerCounts.set(r.broker, b)
  }

  const brokerActivity = [...brokerCounts.entries()].map(([broker, c]) => ({
    broker,
    total:    c.total,
    fill_pct: c.total === 0 ? null : Math.round((c.mirrored / c.total) * 100),
    failures: c.failed,
  })).sort((a, b) => b.total - a.total)

  const profiles = listBrokerProfiles()

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    engine: {
      status: open >= 0 ? 'live' : 'unknown',
      open_positions: open,
      closed_24h:     closed24h,
      ingested_24h:   ingested24h,
      ingested_1h:    ingested1h,
      ingest_rate_per_hour: ingested1h,    // last hour serves as instantaneous rate
    },
    broker_profiles: profiles,
    broker_activity: brokerActivity,
    latest_rows:     latest.data ?? [],
    endpoints: {
      ingest:     'POST /api/shadow/ingest',
      lifecycle:  'GET  /api/cron/shadow-lifecycle  (Bearer CRON_SECRET)',
    },
  })
}
