import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  rating: z.number().int().min(1).max(5),
  title:  z.string().max(100).optional(),
  body:   z.string().max(1000).optional(),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  // Verify the strategy exists and reviewer isn't the creator
  const { data: strategy } = await supabase
    .from('published_strategies')
    .select('creator_id, rating_count, rating_avg')
    .eq('id', id)
    .single()

  if (!strategy) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 })
  if (strategy.creator_id === user.id) {
    return NextResponse.json({ error: 'Cannot review your own strategy' }, { status: 400 })
  }

  // Is the reviewer a paid subscriber? (drives the verified-sub badge)
  const { data: sub } = await supabase
    .from('strategy_subscriptions')
    .select('id, amount_paid_usd')
    .eq('subscriber_id', user.id)
    .eq('strategy_id', id)
    .maybeSingle()
  const isVerifiedSub = !!sub && Number(sub.amount_paid_usd) > 0

  // Upsert review
  const { error: revErr } = await supabase
    .from('strategy_reviews')
    .upsert({
      strategy_id:     id,
      reviewer_id:     user.id,
      rating:          parsed.data.rating,
      title:           parsed.data.title ?? null,
      body:            parsed.data.body ?? null,
      is_verified_sub: isVerifiedSub,
    }, { onConflict: 'strategy_id,reviewer_id' })

  if (revErr) {
    console.error('review error:', revErr)
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 })
  }

  // Recompute rolling average
  const { data: allReviews } = await supabase
    .from('strategy_reviews')
    .select('rating')
    .eq('strategy_id', id)

  const count = allReviews?.length ?? 0
  const avg   = count > 0
    ? allReviews!.reduce((s, r) => s + r.rating, 0) / count
    : 0

  await supabase
    .from('published_strategies')
    .update({
      rating_count: count,
      rating_avg:   Math.round(avg * 10) / 10,
    })
    .eq('id', id)

  return NextResponse.json({ ok: true, rating_avg: avg, rating_count: count })
}
