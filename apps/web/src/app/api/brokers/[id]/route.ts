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
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('broker_connections')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
