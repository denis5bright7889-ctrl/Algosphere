/**
 * /api/automation/events — single ingress for every automation event.
 *
 * Accepts events from:
 *   - the Python signal-engine on Railway (signals, trades, rejections)
 *   - the web app (manual fire, backtest completion)
 *   - Vercel crons (performance.weekly, performance.monthly)
 *   - the admin UI ("Generate now" buttons)
 *
 * Auth: shared-secret bearer token (`AUTOMATION_INGEST_SECRET`). Same
 * pattern as Vercel's CRON_SECRET. Without the env set the endpoint
 * is fail-closed (401 to the whole internet).
 *
 * Admin requests authenticated via supabase auth are ALSO accepted so
 * the admin UI can call this without exposing the shared secret to
 * the browser.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { ingestEvent } from '@/lib/growth/automation'

export const dynamic = 'force-dynamic'

const schema = z.object({
  event_type: z.string().min(3).max(64),
  payload:    z.record(z.string(), z.unknown()).default({}),
  source:     z.string().max(40).optional(),
})

async function authorized(req: Request): Promise<{ ok: boolean; source: string }> {
  // 1. Shared-secret bearer — used by the signal-engine + crons.
  const secret = process.env.AUTOMATION_INGEST_SECRET
  const auth   = req.headers.get('authorization') ?? ''
  if (secret && auth === `Bearer ${secret}`) {
    return { ok: true, source: 'signal-engine' }
  }

  // 2. Admin session — used by /admin/growth/automation's "Fire" button.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user && isAdmin(user.email)) {
    return { ok: true, source: 'admin' }
  }
  return { ok: false, source: 'denied' }
}

export async function POST(req: Request) {
  const auth = await authorized(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const outcome = await ingestEvent({
    event_type: parsed.data.event_type,
    payload:    parsed.data.payload,
    source:     parsed.data.source ?? auth.source,
  })

  return NextResponse.json(outcome, {
    // 200 even on no_match — that's a normal outcome the caller should
    // see, not an error. error / rate_limited still return 200 + body
    // so the engine doesn't retry pointlessly.
    status: 200,
  })
}

// Tiny GET so health-checkers / curl can verify the endpoint is live
// without sending a payload. Authorized requests only.
export async function GET(req: Request) {
  const auth = await authorized(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, ready: true, source: auth.source })
}
