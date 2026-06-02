/**
 * /api/cron/performance-recap — daily cron that fires a weekly
 * performance event ONLY on Mondays (UTC).
 *
 * Pulls the past 7 days of signal + regime activity, packages it
 * into a market_report payload, and dispatches via ingestEvent().
 * The matching automation rule ('weekly digest → Market Report
 * auto-publish') auto-publishes the result.
 *
 * Daily-cron tier note (Vercel Hobby): this fires every day at 08:30
 * UTC and the Monday gate is enforced in code. If the day-of-week
 * check fails the run is a no-op (200 with `skipped:'not_monday'`).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { ingestEvent } from '@/lib/growth/automation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`
}

interface RegimeRow { symbol: string; regime: string; scanned_at: string }

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  if (now.getUTCDay() !== 1) {
    return NextResponse.json({ skipped: 'not_monday', utc_day: now.getUTCDay() })
  }

  const db = svc()

  // Window: last 7 days, ending now (UTC).
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  // 1. Latest regime per symbol — the engine writes regime_snapshots
  //    every scan; collapse to most-recent-per-symbol.
  const { data: snaps } = await db
    .from('regime_snapshots')
    .select('symbol, regime, scanned_at')
    .gte('scanned_at', since)
    .order('scanned_at', { ascending: false })
    .limit(500)

  const seen = new Set<string>()
  const rows: RegimeRow[] = []
  for (const r of (snaps ?? []) as RegimeRow[]) {
    if (seen.has(r.symbol)) continue
    seen.add(r.symbol)
    rows.push(r)
  }

  // 2. 7-day signal + payment counts for the report body.
  const [{ count: signals7 }, { count: payments7 }] = await Promise.all([
    db.from('signals').select('id', { count: 'exact', head: true }).gte('published_at', since),
    db.from('crypto_payments').select('id', { count: 'exact', head: true }).gte('created_at', since),
  ])

  const windowLabel = `${formatYmd(new Date(now.getTime() - 7 * 86_400_000))} → ${formatYmd(now)}`

  // 3. Hand off to the automation engine.
  const outcome = await ingestEvent({
    event_type: 'performance.weekly',
    source:     'cron',
    payload: {
      window_label: windowLabel,
      cadence:      'weekly',
      rows: rows.slice(0, 30).map((r) => ({
        symbol: r.symbol,
        regime: r.regime,
        note:   `last scan: ${formatYmd(new Date(r.scanned_at))}`,
      })),
      // Extra context the future template can use — schema-less.
      summary: {
        signals_7d:  signals7 ?? 0,
        payments_7d: payments7 ?? 0,
        symbol_count: rows.length,
      },
    },
  })

  return NextResponse.json({
    fired_at:   now.toISOString(),
    window:     windowLabel,
    symbols:    rows.length,
    signals_7d: signals7 ?? 0,
    outcome,
  })
}

export const POST = GET

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
