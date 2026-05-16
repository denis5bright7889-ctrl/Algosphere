import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─── PATCH /api/social/subscriptions/[id] ───────────────────
// Update copy settings on an active subscription
const updateSchema = z.object({
  copy_enabled:    z.boolean().optional(),
  copy_mode:       z.enum(['signal_only','semi_auto','full_auto']).optional(),
  allocation_pct:  z.number().min(0.1).max(100).optional(),
  risk_multiplier: z.number().min(0.1).max(5).optional(),
  max_lot_size:    z.number().positive().nullable().optional(),
  copy_sl:         z.boolean().optional(),
  copy_tp:         z.boolean().optional(),
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
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('strategy_subscriptions')
    .update(parsed.data)
    .eq('id', id)
    .eq('subscriber_id', user.id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
  return NextResponse.json({ subscription: data })
}

// ─── DELETE /api/social/subscriptions/[id] ──────────────────
// Cancel a subscription (sets cancelled_at, keeps row for audit)
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('strategy_subscriptions')
    .update({
      status:        'cancelled',
      cancelled_at:  new Date().toISOString(),
      copy_enabled:  false,
    })
    .eq('id', id)
    .eq('subscriber_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
