/**
 * GET /api/admin/validation-ops-dashboard — Phase 13 ops dashboard
 * data feed.
 *
 * Single endpoint that an admin UI can call to render the entire
 * Validation Operations Dashboard. Returns:
 *
 *   • System health         Phase 0 engine state (ingest rate, open
 *                            positions, closed today)
 *   • Writer health         Last successful run + row counts per
 *                            Phase-12 table
 *   • Data freshness        Hours since the newest row in each table
 *   • Stale data detection  Open positions older than 7 days
 *                            (lifecycle ticker probably stuck)
 *   • Pipeline failures     Recent errors from system_event_log
 *                            (if present)
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

interface TableHealth {
  table:                string
  row_count:            number
  newest_ts:            string | null
  hours_since_newest:   number | null
  freshness:            'fresh' | 'stale' | 'empty'
}

async function tableHealth(
  db: ReturnType<typeof svc>,
  table: string,
  tsCol: string,
  freshHours: number,
): Promise<TableHealth> {
  const { count } = await db.from(table).select('*', { count: 'exact', head: true })
  const { data }  = await db
    .from(table)
    .select(tsCol)
    .order(tsCol, { ascending: false })
    .limit(1)
  const newest = (data && data.length > 0)
    ? ((data[0] as unknown) as Record<string, unknown>)[tsCol] as string
    : null
  const hoursSince = newest
    ? Math.round((Date.now() - new Date(newest).getTime()) / 36e5 * 10) / 10
    : null
  let freshness: TableHealth['freshness'] = 'empty'
  if ((count ?? 0) > 0) {
    freshness = (hoursSince != null && hoursSince <= freshHours) ? 'fresh' : 'stale'
  }
  return {
    table,
    row_count:          count ?? 0,
    newest_ts:          newest,
    hours_since_newest: hoursSince,
    freshness,
  }
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
  const since7d  = new Date(now - 7 * 86_400_000).toISOString()

  // ── Phase 0 system health ──────────────────────────────────────
  const [open, closed24h, ingested24h, ingested1h, staleOpen] = await Promise.all([
    db.from('shadow_executions').select('*', { count: 'exact', head: true })
      .in('actual_status', ['mirrored', 'testnet']).is('closed_at', null)
      .then(r => r.count ?? 0),
    db.from('shadow_executions').select('*', { count: 'exact', head: true })
      .gte('closed_at', since24h).then(r => r.count ?? 0),
    db.from('shadow_executions').select('*', { count: 'exact', head: true })
      .gte('created_at', since24h).then(r => r.count ?? 0),
    db.from('shadow_executions').select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(now - 3_600_000).toISOString()).then(r => r.count ?? 0),
    db.from('shadow_executions').select('*', { count: 'exact', head: true })
      .in('actual_status', ['mirrored', 'testnet']).is('closed_at', null)
      .lt('created_at', since7d).then(r => r.count ?? 0),
  ])

  // ── Writer / table health ──────────────────────────────────────
  // Freshness windows are per table — daily writers should be fresh
  // within 36h, weekly writers within 8 days, ingest within 25h.
  const tables = await Promise.all([
    tableHealth(db, 'shadow_executions',              'created_at',     25),
    tableHealth(db, 'validation_snapshots',           'created_at',     36),
    tableHealth(db, 'broker_quality_scores',          'computed_at',    36),
    tableHealth(db, 'strategy_validation_scores',     'computed_at',    36),
    tableHealth(db, 'ai_strategy_reviews',            'reviewed_at',    36),
    tableHealth(db, 'validation_milestones',          'achieved_at',    36 * 7),
    tableHealth(db, 'strategy_rankings',              'computed_at',    36),
    tableHealth(db, 'shadow_sessions',                'started_at',     36),
    tableHealth(db, 'strategy_qualification_history', 'transitioned_at', 36 * 7),
    tableHealth(db, 'trade_explanations',             'generated_at',   36),
    tableHealth(db, 'trade_reviews',                  'reviewed_at',    36),
    tableHealth(db, 'trade_outcomes',                 'computed_at',    36),
    tableHealth(db, 'trade_quality_scores',           'scored_at',      36),
  ])

  // ── Aggregate health ──────────────────────────────────────────
  const freshCount   = tables.filter(t => t.freshness === 'fresh').length
  const staleCount   = tables.filter(t => t.freshness === 'stale').length
  const emptyCount   = tables.filter(t => t.freshness === 'empty').length
  const totalTables  = tables.length

  let systemStatus: 'healthy' | 'degraded' | 'cold' = 'healthy'
  if (emptyCount === totalTables)       systemStatus = 'cold'
  else if (staleCount > totalTables / 2) systemStatus = 'degraded'

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    summary: {
      system_status:        systemStatus,
      tables_fresh:         freshCount,
      tables_stale:         staleCount,
      tables_empty:         emptyCount,
      tables_total:         totalTables,
      stale_open_positions: staleOpen,
    },
    engine: {
      open_positions: open,
      closed_24h:     closed24h,
      ingested_24h:   ingested24h,
      ingested_1h:    ingested1h,
    },
    tables,
    alerts: buildAlerts(systemStatus, tables, staleOpen),
    recommendations: buildRecommendations(systemStatus, tables, staleOpen, ingested24h),
  })
}

function buildAlerts(
  status: 'healthy' | 'degraded' | 'cold',
  tables: TableHealth[],
  staleOpen: number,
): Array<{ severity: 'info' | 'warn' | 'error'; message: string }> {
  const out: Array<{ severity: 'info' | 'warn' | 'error'; message: string }> = []
  if (status === 'cold') {
    out.push({ severity: 'info', message: 'System is in cold-start state: no rows in any Validation Center table yet.' })
  }
  if (staleOpen > 0) {
    out.push({ severity: 'warn', message: `${staleOpen} open shadow position(s) older than 7 days — lifecycle ticker may not be running or symbol has no price source.` })
  }
  for (const t of tables) {
    if (t.freshness === 'stale') {
      out.push({ severity: 'warn', message: `Table ${t.table} hasn't received writes in ${t.hours_since_newest}h.` })
    }
  }
  return out
}

function buildRecommendations(
  status: 'healthy' | 'degraded' | 'cold',
  tables: TableHealth[],
  staleOpen: number,
  ingested24h: number,
): string[] {
  const out: string[] = []
  if (status === 'cold') {
    out.push('POST /api/shadow/ingest with a normalized signal to seed shadow_executions.')
    out.push('Then GET /api/cron/shadow-lifecycle to start the price-tracking loop.')
  }
  if (ingested24h === 0 && status !== 'cold') {
    out.push('No new shadow_executions in 24h — confirm signal ingest is wired in.')
  }
  if (staleOpen > 5) {
    out.push('Investigate the lifecycle ticker — many positions remain open beyond expected duration.')
  }
  const emptyAggregates = tables.filter(t =>
    t.freshness === 'empty' && t.table !== 'shadow_executions',
  )
  if (emptyAggregates.length > 0 && ingested24h > 0) {
    out.push(`POST /api/admin/validation-snapshots-write and /api/admin/validation-aggregates-write to backfill ${emptyAggregates.length} empty aggregate table(s).`)
  }
  return out
}
