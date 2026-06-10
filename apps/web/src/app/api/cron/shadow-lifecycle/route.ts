/**
 * GET /api/cron/shadow-lifecycle
 *
 * Ticks the shadow execution lifecycle: scans open positions, fetches
 * current price (Binance for crypto; honest skip for instruments
 * without a wired-up price source), checks SL/TP hits, and finalizes
 * P&L on close.
 *
 * Auth: Vercel cron sends an `Authorization: Bearer <CRON_SECRET>`
 * header. We also allow admin sessions to trigger manually.
 *
 * Idempotency: the underlying engine guards each row's close with
 * .is('closed_at', null), so concurrent ticks can't double-close.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { tickShadowLifecycle } from '@/lib/intelligence/shadow-execution-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function authorize(request: NextRequest): Promise<boolean> {
  const header = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (secret && header === `Bearer ${secret}`) return true

  // Fallback: an admin session can call this manually.
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
    const result = await tickShadowLifecycle()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

// POST same handler — Vercel cron defaults to GET but allow POST too.
export const POST = GET
