/**
 * POST /api/admin/broker-ownership/[fingerprint]/resolve-all
 *
 * Bulk-resolve (or dismiss) every ACTIVE contender on a fingerprint — the
 * "Resolve All Contenders" action, handy after testing / migrations /
 * backfills / QA. Only active_contention rows are touched; already-resolved
 * ones are left as-is. No audit deletion, no owner change.
 *
 * Body: { action?: 'resolve' | 'dismiss' (default 'resolve'), note?: string }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isAdmin } from '@/lib/admin'

const body = z.object({
  action: z.enum(['resolve', 'dismiss']).optional().default('resolve'),
  note:   z.string().max(500).optional(),
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
  const { action, note } = parsed.data

  const newStatus  = action === 'dismiss' ? 'dismissed_contention' : 'resolved_contention'
  const histAction = action === 'dismiss' ? 'contender_dismissed'  : 'contender_resolved'

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
      resolution_note: note ?? 'resolve_all',
    })
    .eq('fingerprint', fingerprint)
    .eq('status', 'active_contention')   // only active ones
    .select('contender_user_id')

  if (error) return NextResponse.json({ error: 'Bulk update failed' }, { status: 500 })
  const ids = ((updated ?? []) as { contender_user_id: string }[]).map(r => r.contender_user_id)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  svc.from('broker_ownership_history').insert({
    fingerprint, broker: '',
    action: histAction,
    reason: `resolve_all (${ids.length})${note ? ' — ' + note : ''}`,
    actor_id: user.id, ip_address: ip, user_agent: ua,
    metadata: { contender_user_ids: ids, bulk: true },
  }).then(() => {}, () => {})

  svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: `broker.contention.resolve_all`,
    resource_type: 'broker_contention', resource_id: fingerprint,
    after_state: { resolved_count: ids.length, status: newStatus, note: note ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, fingerprint, resolved_count: ids.length, status: newStatus })
}
