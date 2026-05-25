/**
 * POST /api/admin/broker-ownership/[fingerprint]/revoke
 *
 * Admin revokes ownership — the broker becomes claimable by anyone on the
 * next POST /api/brokers (the connect-time gate falls through when
 * ownership_status='revoked'). Existing broker_connections rows are left
 * functional by default; pass disable_connections=true to also mark them
 * status=disabled with the supplied reason (keeps the row + history for
 * forensics, just halts execution).
 *
 * Body: { reason?: string, disable_connections?: boolean }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isAdmin } from '@/lib/admin'

const body = z.object({
  reason:              z.string().max(500).optional(),
  disable_connections: z.boolean().optional().default(false),
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

  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  const { reason, disable_connections } = parsed.data

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: current } = await svc
    .from('broker_account_ownership')
    .select('owner_user_id, broker, ownership_status')
    .eq('fingerprint', fingerprint)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Ownership row not found' }, { status: 404 })
  const cur = current as { owner_user_id: string; broker: string; ownership_status: string }

  const { error } = await svc
    .from('broker_account_ownership')
    .update({
      ownership_status:      'revoked',
      unlink_cooldown_until: null,
      current_connection_id: null,
    })
    .eq('fingerprint', fingerprint)
  if (error) return NextResponse.json({ error: 'Revoke failed' }, { status: 500 })

  // Optionally disable every broker_connections row referencing this fingerprint.
  let disabledIds: string[] = []
  if (disable_connections) {
    const msg = `Admin revoked ownership — ${reason ?? 'no reason'}`
    const { data: updated } = await svc
      .from('broker_connections')
      .update({ status: 'disabled', error_message: msg, state_changed_at: new Date().toISOString() })
      .eq('broker_account_fingerprint', fingerprint)
      .select('id')
    disabledIds = ((updated ?? []) as { id: string }[]).map(r => r.id)
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  svc.from('broker_ownership_history').insert({
    fingerprint, broker: cur.broker,
    previous_owner_user_id: cur.owner_user_id,
    new_owner_user_id:      null,
    action: 'cooldown_lifted',
    reason: reason ?? 'admin_revoke',
    actor_id: user.id, ip_address: ip, user_agent: ua,
    metadata: { disabled_connection_ids: disabledIds },
  }).then(() => {}, () => {})

  svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: 'broker.ownership.revoke',
    resource_type: 'broker_account_ownership', resource_id: fingerprint,
    before_state: { owner_user_id: cur.owner_user_id, status: cur.ownership_status },
    after_state:  { status: 'revoked', disable_connections, disabled_count: disabledIds.length, reason: reason ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, fingerprint, disabled_connections: disabledIds.length })
}
