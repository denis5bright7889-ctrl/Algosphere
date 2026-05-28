import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const patchSchema = z.object({
  label:      z.string().max(80).optional(),
  is_default: z.boolean().optional(),
  is_testnet: z.boolean().optional(),
})

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 })

  // Refuse to flip testnet→live unless explicitly confirmed via separate endpoint
  if (parsed.data.is_testnet === false) {
    return NextResponse.json(
      { error: 'Switching to live requires the /api/brokers/[id]/promote-live endpoint' },
      { status: 403 },
    )
  }

  const svc = createServiceClient()
  const update: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
  if (parsed.data.is_default !== undefined) {
    update.is_live = !parsed.data.is_testnet
  }

  const { data, error } = await svc
    .from('broker_connections')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, broker, label, is_default, is_testnet')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
  return NextResponse.json({ connection: data })
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read the fingerprint + broker BEFORE delete so we can mark cooldown.
  // RLS-scoped: only succeeds if the row belongs to the caller.
  const { data: row } = await supabase
    .from('broker_connections')
    .select('broker_account_fingerprint, broker')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const { error } = await supabase
    .from('broker_connections')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })

  // Cooldown enforcement (slice 3). The ownership row survives the
  // broker_connections delete (current_connection_id was SET NULL by FK);
  // we now flip it to 'cooldown' so no DIFFERENT user can claim the same
  // real-world account for COOLDOWN_HOURS. Same-owner re-link is still
  // allowed instantly (POST handles that). All writes are best-effort —
  // an audit/cooldown failure must never block the delete the user just
  // confirmed.
  const r = row as { broker_account_fingerprint: string | null; broker: string } | null
  const fingerprint = r?.broker_account_fingerprint ?? null
  if (fingerprint) {
    const hours = Number(process.env.BROKER_UNLINK_COOLDOWN_HOURS ?? 24)
    const until = new Date(Date.now() + hours * 3600_000).toISOString()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const ua = req.headers.get('user-agent') ?? null
    const svc = createServiceClient()
    svc.from('broker_account_ownership')
      .update({ ownership_status: 'cooldown', unlink_cooldown_until: until, current_connection_id: null })
      .eq('fingerprint', fingerprint)
      .then(() => {}, () => {})
    svc.from('broker_ownership_history').insert([
      { fingerprint, broker: r!.broker, previous_owner_user_id: user.id,
        action: 'unlinked', actor_id: user.id, ip_address: ip, user_agent: ua },
      { fingerprint, broker: r!.broker, previous_owner_user_id: user.id,
        action: 'cooldown_started', actor_id: user.id, ip_address: ip, user_agent: ua,
        metadata: { unlink_cooldown_until: until, cooldown_hours: hours } },
    ]).then(() => {}, () => {})
  }

  return NextResponse.json({ ok: true })
}
