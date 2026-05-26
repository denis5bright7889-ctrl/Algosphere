/**
 * POST /api/admin/broker-ownership/[fingerprint]/set-ownership-mode
 *
 * Switch a broker account's ownership policy. Admin-only, idempotent,
 * audited. Does not delete history, change the owner, or disable
 * connections — only the policy flags.
 *
 * Body: { mode: 'single_owner'|'shared'|'revoked', shared_enabled?: boolean, reason?: string }
 *
 * Invariants kept in sync:
 *   single_owner → shared_enabled forced false
 *   shared       → shared_enabled forced true (explicit opt-in)
 *   revoked      → ownership_status set 'revoked' too (gate blocks; admin
 *                  reassigns via the transfer endpoint)
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isAdmin } from '@/lib/admin'

const body = z.object({
  mode:           z.enum(['single_owner', 'shared', 'revoked']),
  shared_enabled: z.boolean().optional(),
  reason:         z.string().max(500).optional(),
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
  const { mode, reason } = parsed.data

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: current } = await svc
    .from('broker_account_ownership')
    .select('owner_user_id, broker, ownership_mode, shared_enabled, ownership_status')
    .eq('fingerprint', fingerprint)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Ownership row not found' }, { status: 404 })
  const cur = current as {
    owner_user_id: string; broker: string
    ownership_mode: string; shared_enabled: boolean; ownership_status: string
  }

  const sharedEnabled = mode === 'shared' ? true : mode === 'single_owner' ? false : (parsed.data.shared_enabled ?? cur.shared_enabled)
  const patch: Record<string, unknown> = { ownership_mode: mode, shared_enabled: sharedEnabled }
  if (mode === 'revoked') patch.ownership_status = 'revoked'

  const { error } = await svc
    .from('broker_account_ownership')
    .update(patch)
    .eq('fingerprint', fingerprint)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  svc.from('broker_ownership_history').insert({
    fingerprint, broker: cur.broker,
    previous_owner_user_id: cur.owner_user_id,
    action: mode === 'revoked' ? 'cooldown_lifted' : 'transferred',  // existing enum
    reason: `set_mode:${mode}${reason ? ' — ' + reason : ''}`,
    actor_id: user.id, ip_address: ip, user_agent: ua,
    metadata: { from_mode: cur.ownership_mode, to_mode: mode, shared_enabled: sharedEnabled },
  }).then(() => {}, () => {})

  svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: 'broker.ownership.set_mode',
    resource_type: 'broker_account_ownership', resource_id: fingerprint,
    before_state: { ownership_mode: cur.ownership_mode, shared_enabled: cur.shared_enabled },
    after_state:  { ownership_mode: mode, shared_enabled: sharedEnabled, reason: reason ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, fingerprint, ownership_mode: mode, shared_enabled: sharedEnabled })
}
