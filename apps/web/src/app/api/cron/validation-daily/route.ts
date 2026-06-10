/**
 * GET /api/cron/validation-daily
 *
 * Single chained cron handler that runs the full Validation Center
 * pipeline in sequence:
 *
 *   1. shadow lifecycle tick (close hit-SL/TP positions)
 *   2. forensics writer (compute per-trade explanations)
 *   3. snapshots writer (validation_snapshots row per active user)
 *   4. aggregates writer (broker_quality + strategy_validation +
 *                          ai_reviews + milestones)
 *   5. ops writer (rankings + sessions + qualification history)
 *   6. state-machine writer (OBSERVATION → WATCHLIST → ... transitions)
 *
 * Each step is wrapped in logWriterRun() so failures land in
 * writer_dlq and successes get a writer_runs row.
 *
 * Use this from a single Vercel cron entry to keep the 2-cron Hobby
 * limit safe. Returns a summary JSON the admin endpoint surfaces.
 *
 * Auth: Bearer CRON_SECRET (preferred) OR admin session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { logWriterRun } from '@/lib/intelligence/writer-run-log'
import { tickShadowLifecycle } from '@/lib/intelligence/shadow-execution-engine'
import { writeTradeForensics } from '@/lib/intelligence/trade-forensics-writer'
import { writeValidationSnapshots } from '@/lib/intelligence/validation-snapshots-writer'
import { writeValidationAggregates } from '@/lib/intelligence/validation-aggregates-writer'
import { writeValidationOps } from '@/lib/intelligence/validation-ops-writer'
import { writeStrategyStateMachine } from '@/lib/intelligence/strategy-state-machine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function authorize(request: NextRequest): Promise<boolean> {
  const header = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && header === `Bearer ${secret}`) return true
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return Boolean(user && isAdmin(user.email))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  if (!await authorize(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ranAt = new Date().toISOString()
  const triggered = request.headers.get('user-agent')?.includes('vercel-cron') ? 'cron' : 'admin'
  const steps: Array<{ step: string; outcome: string; rows_written?: number; errors?: number }> = []

  // Each step is independent — failures in one don't block the others.
  // logWriterRun catches errors per step.
  type StepFn = () => Promise<Record<string, unknown> & { errors?: unknown[] }>
  const adapt = <T>(fn: () => Promise<T>): StepFn =>
    async () => (await fn()) as unknown as Record<string, unknown> & { errors?: unknown[] }
  const stepDefs: Array<{ name: string; fn: StepFn }> = [
    { name: 'shadow_lifecycle',         fn: adapt(tickShadowLifecycle) },
    { name: 'trade_forensics',          fn: adapt(() => writeTradeForensics()) },
    { name: 'validation_snapshots',     fn: adapt(writeValidationSnapshots) },
    { name: 'validation_aggregates',    fn: adapt(writeValidationAggregates) },
    { name: 'validation_ops',           fn: adapt(writeValidationOps) },
    { name: 'strategy_state_machine',   fn: adapt(writeStrategyStateMachine) },
  ]
  for (const step of stepDefs) {
    try {
      const result = await logWriterRun(step.name, triggered as 'cron' | 'admin', step.fn)
      const errCount = Array.isArray(result.errors) ? result.errors.length : 0
      steps.push({
        step:         step.name,
        outcome:      errCount > 0 ? 'partial' : 'ok',
        rows_written: inferRows(result),
        errors:       errCount,
      })
    } catch (e) {
      steps.push({
        step:    step.name,
        outcome: 'failed',
        errors:  1,
      })
      void e
    }
  }

  return NextResponse.json({ ok: true, ran_at: ranAt, steps })
}

function inferRows(r: Record<string, unknown>): number {
  let total = 0
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== 'number') continue
    if (k === 'rows_written' || k.endsWith('_written') || k.endsWith('_inserted')) {
      total += v
    }
  }
  return total
}

export const POST = GET
