/**
 * POST /api/admin/broker-ownership/[fingerprint]/transfer
 *
 * Admin force-transfer of ownership. Moves owner_user_id, clears cooldown,
 * records both the ownership history transition AND a global audit_logs
 * entry (consistent with the kill-switch / promote-live admin actions).
 *
 * Body: { new_owner_user_id: string, reason?: string }
 *
 * No risk-score reset — risk persists across owners on purpose so the
 * suspicious-account signal isn't laundered by a transfer.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isAdmin } from '@/lib/admin'

const body = z.object({
  new_owner_user_id: z.string().uuid(),
  reason:            z.string().max(500).optional(),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ fingerprint: string }> },
) {
  const { fingerprint } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  const { new_owner_user_id, reason } = parsed.data

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: current } = await svc
    .from('broker_account_ownership')
    .select('owner_user_id, broker')
    .eq('fingerprint', fingerprint)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Ownership row not found' }, { status: 404 })
  const cur = current as { owner_user_id: string; broker: string }
  if (cur.owner_user_id === new_owner_user_id) {
    return NextResponse.json({ ok: true, no_change: true })
  }

  const { error } = await svc
    .from('broker_account_ownership')
    .update({
      owner_user_id:         new_owner_user_id,
      ownership_status:      'active',
      unlink_cooldown_until: null,
      current_connection_id: null,
      last_seen_at:          new Date().toISOString(),
    })
    .eq('fingerprint', fingerprint)
  if (error) return NextResponse.json({ error: 'Transfer failed' }, { status: 500 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  // Ownership history + global admin audit. Both best-effort.
  svc.from('broker_ownership_history').insert({
    fingerprint, broker: cur.broker,
    previous_owner_user_id: cur.owner_user_id,
    new_owner_user_id:      new_owner_user_id,
    action: 'transferred',
    reason: reason ?? 'admin_force_transfer',
    actor_id: user.id, ip_address: ip, user_agent: ua,
  }).then(() => {}, () => {})

  svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: 'broker.ownership.transfer',
    resource_type: 'broker_account_ownership', resource_id: fingerprint,
    before_state: { owner_user_id: cur.owner_user_id },
    after_state:  { owner_user_id: new_owner_user_id, reason: reason ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, fingerprint, new_owner_user_id })
}
