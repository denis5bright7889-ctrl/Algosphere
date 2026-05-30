/**
 * /api/cron/growth-publish — Vercel Cron worker that drains the
 * growth_scheduled_posts queue.
 *
 * Schedule: every 2 minutes (see vercel.json). The endpoint:
 *   1. Authenticates via Authorization: Bearer ${CRON_SECRET}.
 *      Vercel Cron sends this header automatically when CRON_SECRET
 *      is set on the project; a missing/wrong header → 401, so this
 *      endpoint is safe to leave unauthenticated to the rest of the
 *      internet.
 *   2. Pulls up to MAX_PER_TICK queued rows where send_at <= now().
 *   3. Calls publishOne() per row. Failures are logged into
 *      growth_post_attempts; the row flips to 'failed' and is NOT
 *      auto-retried (manual "Post now" or a future retry policy).
 *
 * Returns a summary so the Vercel cron log is useful.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { publishOne } from '@/lib/growth/scheduler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PER_TICK = 10

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false   // fail-closed if CRON_SECRET isn't configured
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = svc()
  const { data: queue, error } = await db
    .from('growth_scheduled_posts')
    .select('id, send_at')
    .eq('status', 'queued')
    .lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true })
    .limit(MAX_PER_TICK)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const ids = (queue ?? []).map((r) => r.id)
  const results: Array<{ id: string; ok: boolean; error?: string }> = []

  for (const id of ids) {
    const outcome = await publishOne(id)
    results.push({ id, ok: outcome.ok, error: outcome.error })
  }

  return NextResponse.json({
    ticked_at: new Date().toISOString(),
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed:    results.filter((r) => !r.ok).length,
    results,
  })
}

// Vercel Cron sends GET requests by default. Accept POST too so manual
// curl invocations work the same.
export const POST = GET
