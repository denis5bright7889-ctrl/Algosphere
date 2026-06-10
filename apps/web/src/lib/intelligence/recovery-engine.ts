/**
 * Recovery Engine — Phase N of the Auto-Live spec.
 *
 * Scans for known failure modes and takes safe automatic recovery
 * actions. Every action logs to recovery_logs with outcome +
 * duration. Failures here NEVER fabricate data — they either
 * recover real state or skip.
 *
 * Detection rules:
 *
 *   1. dlq_retry           — writer_dlq rows with retry_count < 3 and
 *                            unresolved; re-runs the relevant writer
 *                            (no per-row replay — full writer retry).
 *
 *   2. stuck_lifecycle     — shadow rows where lifecycle_status='OPEN'
 *                            AND created_at < 30min ago AND there's
 *                            still no closed_at. Triggers a lifecycle
 *                            tick.
 *
 *   3. stale_writer        — writer_runs latest outcome='failed' AND
 *                            no successful run in past 6h. Triggers
 *                            re-run of that specific writer.
 *
 *   4. orphaned_position   — shadow rows with no signal_source set
 *                            (older than 1h). Patches with 'manual'
 *                            so downstream filters work.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import { tickShadowLifecycle } from './shadow-execution-engine'
import { writeTradeForensics } from './trade-forensics-writer'
import { writeValidationSnapshots } from './validation-snapshots-writer'
import { writeValidationAggregates } from './validation-aggregates-writer'
import { writeValidationOps } from './validation-ops-writer'
import { writeStrategyStateMachine } from './strategy-state-machine'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface RecoveryResult {
  ran_at:           string
  detections:       number
  actions_taken:    number
  recoveries_ok:    number
  recoveries_failed: number
  log:              Array<{ kind: string; action: string; outcome: string; error?: string }>
}

const WRITER_FNS: Record<string, () => Promise<unknown>> = {
  trade_forensics:        () => writeTradeForensics(),
  validation_snapshots:   () => writeValidationSnapshots(),
  validation_aggregates:  () => writeValidationAggregates(),
  validation_ops:         () => writeValidationOps(),
  strategy_state_machine: () => writeStrategyStateMachine(),
  shadow_lifecycle:       () => tickShadowLifecycle(),
}

async function recordAction(
  db: SupabaseClient,
  kind: string, context: Record<string, unknown>, action: string,
  fn: () => Promise<void>,
): Promise<{ outcome: 'recovered' | 'failed' | 'skipped'; error?: string }> {
  const detectedAt = new Date().toISOString()
  const t0 = Date.now()
  const { data: logRow } = await db.from('recovery_logs').insert({
    detected_at: detectedAt, problem_kind: kind, context, action_taken: action, outcome: 'pending',
  }).select('id').single()
  const logId = (logRow as { id: string } | null)?.id

  try {
    await fn()
    if (logId) {
      await db.from('recovery_logs').update({
        outcome: 'recovered', duration_ms: Date.now() - t0,
        finished_at: new Date().toISOString(),
      }).eq('id', logId)
    }
    return { outcome: 'recovered' }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (logId) {
      await db.from('recovery_logs').update({
        outcome: 'failed', duration_ms: Date.now() - t0,
        finished_at: new Date().toISOString(), error,
      }).eq('id', logId)
    }
    return { outcome: 'failed', error }
  }
}

export async function runRecovery(): Promise<RecoveryResult> {
  const db = svc()
  const ranAt = new Date().toISOString()
  const result: RecoveryResult = {
    ran_at: ranAt, detections: 0, actions_taken: 0,
    recoveries_ok: 0, recoveries_failed: 0, log: [],
  }

  // 1 — DLQ retry: group unresolved errors by writer_name, re-run
  //     each writer at most once.
  const { data: dlq } = await db
    .from('writer_dlq')
    .select('id, writer_name, retry_count')
    .eq('resolved', false)
    .lt('retry_count', 3)
    .limit(100)
  const writersToRetry = new Set<string>()
  for (const r of ((dlq ?? []) as Array<{ writer_name: string }>)) {
    writersToRetry.add(r.writer_name)
  }
  result.detections += writersToRetry.size

  for (const writerName of writersToRetry) {
    const fn = WRITER_FNS[writerName]
    if (!fn) continue
    result.actions_taken++
    const r = await recordAction(db, 'dlq_retry', { writer_name: writerName },
      `re-run writer ${writerName}`, async () => { await fn() })
    result.log.push({ kind: 'dlq_retry', action: `rerun ${writerName}`, outcome: r.outcome, error: r.error })
    if (r.outcome === 'recovered') {
      result.recoveries_ok++
      await db.from('writer_dlq')
        .update({ resolved: true, resolved_at: new Date().toISOString(), retry_count: 999 })
        .eq('writer_name', writerName).eq('resolved', false)
    } else {
      result.recoveries_failed++
      // No RPC — fall back to direct SELECT-then-UPDATE of retry_count.
      const { data: dlqRows } = await db.from('writer_dlq')
        .select('id, retry_count').eq('writer_name', writerName).eq('resolved', false)
      for (const row of ((dlqRows ?? []) as Array<{ id: string; retry_count: number }>)) {
        await db.from('writer_dlq').update({ retry_count: row.retry_count + 1 }).eq('id', row.id)
      }
    }
  }

  // 2 — stuck_lifecycle: open positions > 30 min with crypto symbol → tick
  const stuckSince = new Date(Date.now() - 30 * 60_000).toISOString()
  const { count: stuckOpen } = await db
    .from('shadow_executions').select('*', { count: 'exact', head: true })
    .is('closed_at', null)
    .in('actual_status', ['mirrored', 'testnet'])
    .lt('created_at', stuckSince)
  if ((stuckOpen ?? 0) > 0) {
    result.detections++
    result.actions_taken++
    const r = await recordAction(db, 'stuck_lifecycle', { stuck_count: stuckOpen ?? 0 },
      'tick lifecycle to attempt close', async () => { await tickShadowLifecycle() })
    result.log.push({ kind: 'stuck_lifecycle', action: 'lifecycle tick', outcome: r.outcome, error: r.error })
    r.outcome === 'recovered' ? result.recoveries_ok++ : result.recoveries_failed++
  }

  // 3 — stale_writer: latest run failed AND no success in 6h
  const since6h = new Date(Date.now() - 6 * 3_600_000).toISOString()
  const { data: latestRuns } = await db
    .from('writer_runs').select('writer_name, outcome, started_at')
    .order('started_at', { ascending: false }).limit(200)
  const latestByWriter = new Map<string, { outcome: string; started_at: string }>()
  for (const r of ((latestRuns ?? []) as Array<{ writer_name: string; outcome: string; started_at: string }>)) {
    if (!latestByWriter.has(r.writer_name)) latestByWriter.set(r.writer_name, r)
  }
  for (const [writerName, run] of latestByWriter) {
    if (run.outcome !== 'failed') continue
    if (writersToRetry.has(writerName)) continue   // already handled above
    const fn = WRITER_FNS[writerName]
    if (!fn) continue
    if (run.started_at >= since6h) continue   // recent failure; wait
    result.detections++
    result.actions_taken++
    const r = await recordAction(db, 'stale_writer', { writer_name: writerName, last_run: run.started_at },
      `re-run stale writer ${writerName}`, async () => { await fn() })
    result.log.push({ kind: 'stale_writer', action: `rerun ${writerName}`, outcome: r.outcome, error: r.error })
    r.outcome === 'recovered' ? result.recoveries_ok++ : result.recoveries_failed++
  }

  // 4 — orphaned_position: shadow rows without signal_source set (older than 1h)
  const since1h = new Date(Date.now() - 3_600_000).toISOString()
  const { data: orphans } = await db
    .from('shadow_executions')
    .select('id').is('signal_source', null).lt('created_at', since1h).limit(500)
  if (((orphans ?? []) as Array<{ id: string }>).length > 0) {
    result.detections++
    result.actions_taken++
    const r = await recordAction(db, 'orphaned_position', { orphan_count: (orphans as Array<{id: string}>).length },
      'stamp signal_source=manual on orphan rows', async () => {
        const ids = (orphans as Array<{ id: string }>).map(o => o.id)
        await db.from('shadow_executions')
          .update({ signal_source: 'manual' }).in('id', ids)
      })
    result.log.push({ kind: 'orphaned_position', action: 'stamp manual', outcome: r.outcome, error: r.error })
    r.outcome === 'recovered' ? result.recoveries_ok++ : result.recoveries_failed++
  }

  return result
}
