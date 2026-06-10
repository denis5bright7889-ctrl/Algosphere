/**
 * GET /api/cron/auto-live
 *
 * Single chained Auto-Live cycle:
 *   1. detect + enqueue alerts
 *   2. dispatch pending alerts
 *   3. run recovery
 *
 * Designed to run every 15-30 min in production. Independent of
 * /api/cron/validation-daily (which runs the data pipeline).
 *
 * Auth: Bearer CRON_SECRET OR admin session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { detectAndEnqueue, dispatchPending } from '@/lib/intelligence/alert-engine'
import { runRecovery } from '@/lib/intelligence/recovery-engine'

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
  try {
    const detect    = await detectAndEnqueue()
    const dispatch  = await dispatchPending()
    const recovery  = await runRecovery()
    return NextResponse.json({ ok: true, ran_at: ranAt, detect, dispatch, recovery })
  } catch (e) {
    return NextResponse.json(
      { ok: false, ran_at: ranAt, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

export const POST = GET
