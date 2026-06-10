/**
 * Writer run history + DLQ helper.
 *
 * Every writer wraps its execution with logWriterRun(name, triggeredBy,
 * fn) so failures land in writer_dlq and successes get a writer_runs
 * row with duration, rows_written, and the result summary.
 *
 * Used by /api/cron/validation-daily and the admin endpoints.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface RunResult {
  rows_written?: number
  errors?:       unknown[]
  [key: string]: unknown
}

export async function logWriterRun<T extends RunResult>(
  writerName: string,
  triggeredBy: 'cron' | 'admin' | 'system',
  fn: () => Promise<T>,
): Promise<T & { run_id: string }> {
  const db = svc()
  const startedAt = new Date().toISOString()

  const { data: runRow, error: insertErr } = await db
    .from('writer_runs')
    .insert({ writer_name: writerName, triggered_by: triggeredBy, started_at: startedAt, outcome: 'running' })
    .select('id')
    .single()
  const runId = insertErr ? '' : (runRow as { id: string }).id

  const t0 = Date.now()
  let outcome: 'ok' | 'partial' | 'failed' = 'ok'
  let result: T | null = null
  let errorMsg: string | null = null

  try {
    result = await fn()
    const errCount = Array.isArray(result.errors) ? result.errors.length : 0
    const rowsWritten = inferRowsWritten(result)
    if (errCount > 0 && rowsWritten > 0) outcome = 'partial'
    else if (errCount > 0)                outcome = 'failed'
    // DLQ entries for every captured error
    if (runId && errCount > 0) {
      const dlqRows = (result.errors as Array<Record<string, unknown>>).map(e => ({
        writer_name:   writerName,
        run_id:        runId,
        user_id:       (e.user_id as string) ?? null,
        error_message: (e.error as string) ?? 'unknown',
        error_context: e,
      }))
      await db.from('writer_dlq').insert(dlqRows)
    }
  } catch (e) {
    outcome = 'failed'
    errorMsg = e instanceof Error ? e.message : String(e)
    if (runId) {
      await db.from('writer_dlq').insert({
        writer_name:   writerName,
        run_id:        runId,
        error_message: errorMsg,
        error_context: { thrown: true },
      })
    }
  }

  const duration = Date.now() - t0
  if (runId) {
    await db.from('writer_runs').update({
      finished_at:    new Date().toISOString(),
      duration_ms:    duration,
      rows_written:   result ? inferRowsWritten(result) : 0,
      errors_count:   result?.errors ? (result.errors as unknown[]).length : (errorMsg ? 1 : 0),
      result_summary: result ?? { error: errorMsg },
      outcome,
    }).eq('id', runId)
  }

  if (!result) {
    throw new Error(errorMsg ?? 'Writer threw without result')
  }
  return { ...result, run_id: runId }
}

function inferRowsWritten(r: RunResult): number {
  // Each writer uses different field names — sum the numeric ones
  // that look like written-counts. Belt-and-braces.
  let total = 0
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== 'number') continue
    if (k === 'rows_written' || k.endsWith('_written') ||
        k.endsWith('_inserted') || k.endsWith('_count') && k !== 'errors_count') {
      total += v
    }
  }
  return total
}
