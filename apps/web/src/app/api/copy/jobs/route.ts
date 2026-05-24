import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/copy/jobs?limit=50&status=…
 *
 * The follower's recent copy_jobs (one row per signal × subscription),
 * RLS-confined: the user sees only their own jobs. Use ?status= to filter
 * (e.g. status=queued or status=filled).
 *
 * Fields surface enough for the dashboard "What did the workers do?" view:
 * trace_id (search across signal_events / execution_events), allocation,
 * risk reason if rejected, last_error if failed, and the linked copy_trade.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200)
  const status = url.searchParams.get('status')

  let q = supabase
    .from('copy_jobs')
    .select(
      'id, trace_id, kind, status, attempts, computed_lot, ' +
      'allocation_model, risk_reason, last_error, copy_trade_id, ' +
      'signal_event_id, created_at, updated_at, filled_at',
    )
    .eq('follower_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [] })
}
