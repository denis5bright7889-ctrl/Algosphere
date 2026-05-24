import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/coach/alerts?include_ack=0
 *
 * Behavioral coach alerts for the user (revenge / overtrade / oversizing /
 * loss_streak / consistency_drift / winrate_drop). Open (unacknowledged)
 * only by default; include_ack=1 returns the full history.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const includeAck = new URL(req.url).searchParams.get('include_ack') === '1'

  let q = supabase.from('coach_alerts')
    .select('id, kind, severity, title, payload, acknowledged, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(100)
  if (!includeAck) q = q.eq('acknowledged', false)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerts: data ?? [] })
}
