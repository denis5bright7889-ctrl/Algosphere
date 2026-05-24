import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/copy/reconciliation?open=1
 *
 * Desync ledger entries for the follower — missed_trade, partial_fill,
 * desync_qty, desync_missing, orphan_position, price_drift. Written by the
 * reconciler when broker truth diverges from copy_trades. ?open=1 returns
 * only unresolved.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const onlyOpen = url.searchParams.get('open') === '1'

  let q = supabase.from('copy_reconciliation')
    .select('id, kind, severity, expected, observed, resolution, ' +
            'resolved_at, detected_at, copy_trade_id, copy_job_id')
    .eq('follower_id', user.id)
    .order('detected_at', { ascending: false })
    .limit(100)
  if (onlyOpen) q = q.is('resolved_at', null)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data ?? [] })
}
