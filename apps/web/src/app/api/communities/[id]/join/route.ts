import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  plan: z.enum(['free', 'monthly', 'annual']).default('monthly'),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 422 })

  const { data: community } = await supabase
    .from('premium_communities')
    .select('id, owner_id, price_monthly, price_annual, is_free, status, telegram_invite_link')
    .eq('id', id)
    .single()

  if (!community || community.status !== 'active') {
    return NextResponse.json({ error: 'Community not available' }, { status: 404 })
  }
  if (community.owner_id === user.id) {
    return NextResponse.json({ error: 'You own this community' }, { status: 400 })
  }

  const price = community.is_free
    ? 0
    : parsed.data.plan === 'annual'
      ? (community.price_annual ?? community.price_monthly * 12 * 0.8)
      : community.price_monthly

  // Paid → route through crypto payment flow
  if (price > 0) {
    return NextResponse.json({
      requires_payment: true,
      amount_usd: price,
      payment_url: `/dashboard/upgrade?community=${id}&plan=${parsed.data.plan}`,
    })
  }

  const expiresAt = parsed.data.plan === 'annual'
    ? new Date(Date.now() + 365 * 86400_000).toISOString()
    : parsed.data.plan === 'monthly'
      ? new Date(Date.now() + 30 * 86400_000).toISOString()
      : null

  const { data: membership, error } = await supabase
    .from('community_memberships')
    .upsert({
      community_id:    id,
      member_id:       user.id,
      plan:            parsed.data.plan,
      amount_paid_usd: 0,
      status:          'active',
      access_granted:  true,
      expires_at:      expiresAt,
    }, { onConflict: 'community_id,member_id' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to join' }, { status: 500 })
  }

  await supabase
    .from('premium_communities')
    .update({ member_count: (await supabase
      .from('community_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', id)
      .eq('status', 'active')).count ?? 1 })
    .eq('id', id)

  return NextResponse.json({
    membership,
    telegram_invite: community.telegram_invite_link ?? null,
  })
}
