/**
 * POST /api/admin/validation-snapshots-write
 *
 * Manually trigger the validation_snapshots writer. Admin-only.
 * Returns a report showing users processed + snapshots written.
 *
 * Wire this into the daily-content cron later (chained) once the
 * 2-cron Hobby-tier limit is freed up, OR call it from an external
 * scheduler (Railway worker, cron-job.org, etc).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { writeValidationSnapshots } from '@/lib/intelligence/validation-snapshots-writer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const report = await writeValidationSnapshots()
    return NextResponse.json({ ok: true, ...report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

// GET shows the same body so an admin can inspect from the browser
// without crafting a POST. Reads the latest snapshot row per user
// from validation_snapshots as a quick "is the writer working" check.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: latest, error } = await supabase
    .from('validation_snapshots')
    .select('user_id, snapshot_date, sessions_count, cumulative_pnl, rolling_win_rate_pct, rolling_drawdown_pct')
    .order('snapshot_date', { ascending: false })
    .limit(50)

  return NextResponse.json({
    ok:                  !error,
    error:               error?.message ?? null,
    latest_snapshots:    latest ?? [],
    hint:                'POST this endpoint to run the writer; result is upserted into validation_snapshots.',
  })
}
