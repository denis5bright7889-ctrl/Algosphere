/**
 * GET /api/cron/auto-signals — Phase B Signal Scheduler.
 *
 * Trigger the Auto Signal Factory. Designed for frequent invocation
 * (every 5/15/60 min via scheduler) — the factory's per-user
 * rate-limit (20 signals/hour) is the actual throttle.
 *
 * Auth: Bearer CRON_SECRET OR admin session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { runAutoSignalFactory } from '@/lib/intelligence/auto-signal-factory'

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
  try {
    const result = await runAutoSignalFactory()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

export const POST = GET
