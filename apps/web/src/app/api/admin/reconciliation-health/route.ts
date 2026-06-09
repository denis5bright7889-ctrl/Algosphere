/**
 * GET /api/admin/reconciliation-health — close-enrichment health.
 *
 * Phase 6 of the broker-reality close-enrichment work. Surfaces:
 *
 *   closed_positions_detected   — POSITION_CLOSED events (24h)
 *   closed_deals_found          — enriched POSITION_CLOSED events
 *                                 (payload.enriched=true)  (24h)
 *   enrichment_rate             — found / detected
 *   orphan_closures             — POSITION_CLOSED events whose
 *                                 matching ORDER_FILLED isn't on
 *                                 record (24h)
 *   journal_unenriched          — auto journal rows currently NULL on
 *                                 exit_price (the backfill target set
 *                                 for the next reconciler cycle)
 *   last_sync_time              — engine_heartbeats.broker_reconciler
 *
 * Admin-only. Returns a stable shape; safe for the UI to poll.
 *
 * GET /api/admin/journal-backfill-closes is an alias that returns the
 * same data — backwards-compat with the user's spec.
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

interface ExecEventRow {
  payload: Record<string, unknown> | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = svc()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    closedRes,
    fillRes,
    unenrichedRes,
    enrichedJournalRes,
    hbRes,
  ] = await Promise.all([
    db.from('execution_events').select('payload').eq('event_type', 'POSITION_CLOSED').gte('created_at', since24h),
    db.from('execution_events').select('payload').eq('event_type', 'ORDER_FILLED').gte('created_at', since24h),
    db.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .in('source', ['auto', 'auto_human', 'auto_engine'])
      .is('exit_price', null)
      .not('auto_position_id', 'is', null),
    db.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .in('source', ['auto', 'auto_human', 'auto_engine'])
      .not('exit_price', 'is', null),
    db.from('engine_heartbeats').select('component, last_at').eq('component', 'broker_reconciler').maybeSingle(),
  ])

  const closed       = (closedRes.data ?? []) as ExecEventRow[]
  const fills        = (fillRes.data   ?? []) as ExecEventRow[]
  const closedTotal  = closed.length
  const fillsTotal   = fills.length

  const enrichedCount = closed.filter((e) => e.payload?.enriched === true).length

  // Orphan closes: POSITION_CLOSED with a position_id that has no
  // matching ORDER_FILLED in the same window.
  const fillPosIds = new Set<string>()
  for (const e of fills) {
    const p = e.payload ?? {}
    const pid = (p['broker_pos_id'] ?? p['position_id'] ?? p['order_id']) as string | undefined
    if (pid) fillPosIds.add(String(pid))
  }
  let orphanClosures = 0
  for (const e of closed) {
    const p = e.payload ?? {}
    const pid = (p['broker_pos_id'] ?? p['position_id'] ?? p['order_id']) as string | undefined
    if (pid && !fillPosIds.has(String(pid))) orphanClosures += 1
  }

  const enrichmentRate = closedTotal === 0 ? null : Math.round((enrichedCount / closedTotal) * 100)

  const journalUnenriched = unenrichedRes.count ?? 0
  const journalEnriched   = enrichedJournalRes.count ?? 0

  const hbLastAt = hbRes.data?.last_at ?? null
  const reconcilerAgeS = hbLastAt
    ? Math.round((Date.now() - new Date(hbLastAt).getTime()) / 1000)
    : null

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    window: 'last 24h',
    closed_positions_detected: closedTotal,
    closed_deals_found:        enrichedCount,
    enrichment_rate_pct:       enrichmentRate,
    orphan_closures:           orphanClosures,
    order_fills_seen:          fillsTotal,
    journal_unenriched:        journalUnenriched,
    journal_enriched:          journalEnriched,
    reconciler_last_heartbeat: hbLastAt,
    reconciler_age_seconds:    reconcilerAgeS,
    backfill_strategy: journalUnenriched > 0
      ? `${journalUnenriched} unenriched rows will be picked up on the next broker_reconciler cycle (~30s). The reconciler runs Phase 4 backfill on every cycle when get_closed_deals is available.`
      : 'all auto journal rows have exit data — backfill set is empty.',
  })
}
