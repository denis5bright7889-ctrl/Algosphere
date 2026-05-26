/**
 * GET /api/admin/broker-ownership/[fingerprint]/ownership-status
 *
 * Single-account ownership snapshot: current owner, policy mode,
 * shared flag, lifecycle status, and contention counts (active /
 * resolved / dismissed). Admin-only, read-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ fingerprint: string }> },
) {
  const { fingerprint } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const [ownRes, contRes] = await Promise.all([
    svc.from('broker_account_ownership')
       .select('fingerprint, broker, owner_user_id, ownership_mode, shared_enabled, ownership_status, unlink_cooldown_until, risk_score')
       .eq('fingerprint', fingerprint).maybeSingle(),
    svc.from('broker_contention')
       .select('status')
       .eq('fingerprint', fingerprint),
  ])

  if (!ownRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const o = ownRes.data as Record<string, unknown>
  const cont = (contRes.data ?? []) as { status: string }[]

  const count = (s: string) => cont.filter(c => c.status === s).length

  return NextResponse.json({
    fingerprint,
    broker:           o.broker,
    current_owner_user_id: o.owner_user_id,
    ownership_mode:   o.ownership_mode,
    shared_enabled:   o.shared_enabled,
    ownership_status: o.ownership_status,
    risk_score:       o.risk_score,
    contention: {
      active:    count('active_contention'),
      resolved:  count('resolved_contention'),
      dismissed: count('dismissed_contention'),
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
