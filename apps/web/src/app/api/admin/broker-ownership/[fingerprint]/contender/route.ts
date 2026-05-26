/**
 * POST /api/admin/broker-ownership/[fingerprint]/contender
 *
 * Resolve or dismiss a single blocked contender — flips the
 * broker_contention state row OUT of active_contention without touching
 * any audit. Preserves: the reclaim_blocked history, timestamps, IPs,
 * user-agents, attempt_count, risk metadata. Does NOT revoke the owner,
 * disable connections, or delete rows.
 *
 * Body: { contender_user_id: string, action: 'resolve' | 'dismiss', note?: string }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isAdmin } from '@/lib/admin'

const body = z.object({
  contender_user_id: z.string().uuid(),
  action:            z.enum(['resolve', 'dismiss']),
  note:              z.string().max(500).optional(),
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
  const { contender_user_id, action, note } = parsed.data

  const newStatus = action === 'dismiss' ? 'dismissed_contention' : 'resolved_contention'
  const histAction = action === 'dismiss' ? 'contender_dismissed' : 'contender_resolved'

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: updated, error } = await svc
    .from('broker_contention')
    .update({
      status:          newStatus,
      resolved_at:     new Date().toISOString(),
      resolved_by:     user.id,
      resolution_note: note ?? null,
    })
    .eq('fingerprint', fingerprint)
    .eq('contender_user_id', contender_user_id)
    .select('contender_user_id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Contender not found' }, { status: 404 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  // Audit trail — the reclaim_blocked rows stay; this just records the
  // admin's review decision. Best-effort.
  svc.from('broker_ownership_history').insert({
    fingerprint, broker: '',
    new_owner_user_id: contender_user_id,
    action: histAction,
    reason: note ?? `admin ${action}`,
    actor_id: user.id, ip_address: ip, user_agent: ua,
  }).then(() => {}, () => {})

  svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: `broker.contention.${action}`,
    resource_type: 'broker_contention', resource_id: fingerprint,
    after_state: { contender_user_id, status: newStatus, note: note ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, fingerprint, contender_user_id, status: newStatus })
}
