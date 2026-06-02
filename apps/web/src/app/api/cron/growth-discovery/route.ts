/**
 * /api/cron/growth-discovery — daily Reddit ingest.
 *
 * Vercel cron entry in vercel.json. Auth via Bearer ${CRON_SECRET}.
 * Idempotent (dedup-by-fullname inside the scanner) — safe to run
 * multiple times per day.
 */
import { NextResponse } from 'next/server'
import { runDiscoveryScan } from '@/lib/growth/discovery'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const summary = await runDiscoveryScan()
  return NextResponse.json({ fired_at: new Date().toISOString(), ...summary })
}

export const POST = GET
