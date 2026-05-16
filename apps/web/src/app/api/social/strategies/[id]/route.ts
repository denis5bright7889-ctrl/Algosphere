import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─── PATCH /api/social/strategies/[id] ──────────────────────
const updateSchema = z.object({
  name:             z.string().min(3).max(80).optional(),
  tagline:          z.string().max(120).optional(),
  description:      z.string().max(2000).optional(),
  asset_classes:    z.array(z.string()).min(1).optional(),
  pairs:            z.array(z.string()).optional(),
  timeframes:       z.array(z.string()).optional(),
  trading_style:    z.enum(['scalping','day','swing','position']).nullable().optional(),
  risk_approach:    z.enum(['conservative','moderate','aggressive']).nullable().optional(),
  is_free:          z.boolean().optional(),
  price_monthly:    z.number().positive().nullable().optional(),
  price_annual:     z.number().positive().nullable().optional(),
  price_lifetime:   z.number().positive().nullable().optional(),
  copy_enabled:     z.boolean().optional(),
  copy_mode:        z.enum(['signal_only','semi_auto','full_auto']).optional(),
  profit_share_pct: z.number().min(0).max(50).optional(),
  status:           z.enum(['draft','archived']).optional(),
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
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const { data, error } = await supabase
    .from('published_strategies')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('creator_id', user.id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
  return NextResponse.json({ strategy: data })
}

// ─── DELETE /api/social/strategies/[id] ─────────────────────
// Archive (soft-delete) — keeps subscriber history intact
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('published_strategies')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('creator_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to archive' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
