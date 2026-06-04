/**
 * /api/cron/daily-content — Vercel Cron worker that fires the daily
 * content mix orchestrator.
 *
 * Schedule: 06:00 UTC daily (see vercel.json). Produces up to nine
 * pieces of content per day (3 educational + 2 market + 1 feature
 * + 1 psychology + 1 video stub + 1 screenshot stub) via the
 * existing automation engine — no fabrication, sample-gated, fully
 * routed through the auto-publish whitelist + admin approval gate.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Vercel Cron sends this
 * automatically when CRON_SECRET is configured on the project.
 *
 * Manual fire (admin curl): same header, GET or POST.
 */
import { NextResponse } from 'next/server'
import { runDailyMix } from '@/lib/growth/daily-mix'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runDailyMix()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}

export const POST = GET
