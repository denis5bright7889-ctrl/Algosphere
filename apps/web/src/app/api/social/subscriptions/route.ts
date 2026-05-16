import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { effectivePrice } from '@/lib/strategies'

// ─── GET /api/social/subscriptions ──────────────────────────
// List current user's active subscriptions
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('strategy_subscriptions')
    .select(`
      *,
      published_strategies (
        id, name, slug, tagline, win_rate, sharpe_ratio,
        max_drawdown, creator_id,
        profiles!published_strategies_creator_id_fkey ( public_handle )
      )
    `)
    .eq('subscriber_id', user.id)
    .order('started_at', { ascending: false })

  if (error) {
    console.error('subscriptions list error:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
  return NextResponse.json({ subscriptions: data ?? [] })
}

// ─── POST /api/social/subscriptions ─────────────────────────
// Subscribe to a strategy. Free strategies activate immediately.
// Paid strategies route to crypto payment flow (returns payment_intent).
const subscribeSchema = z.object({
  strategy_id:     z.string().uuid(),
  plan:            z.enum(['free','monthly','annual','lifetime']).default('monthly'),
  copy_enabled:    z.boolean().default(false),
  copy_mode:       z.enum(['signal_only','semi_auto','full_auto']).default('signal_only'),
  allocation_pct:  z.number().min(0.1).max(100).default(5),
  risk_multiplier: z.number().min(0.1).max(5).default(1),
  max_lot_size:    z.number().positive().optional(),
  copy_sl:         z.boolean().default(true),
  copy_tp:         z.boolean().default(true),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const input = parsed.data

  // Load strategy
  const { data: strategy, error: strErr } = await supabase
    .from('published_strategies')
    .select('*')
    .eq('id', input.strategy_id)
    .eq('status', 'active')
    .single()

  if (strErr || !strategy) {
    return NextResponse.json({ error: 'Strategy not available' }, { status: 404 })
  }

  // No self-subscription
  if (strategy.creator_id === user.id) {
    return NextResponse.json({ error: 'Cannot subscribe to your own strategy' }, { status: 400 })
  }

  // Check existing subscription
  const { data: existing } = await supabase
    .from('strategy_subscriptions')
    .select('id, status')
    .eq('subscriber_id', user.id)
    .eq('strategy_id', input.strategy_id)
    .maybeSingle()

  if (existing && existing.status === 'active') {
    return NextResponse.json({ error: 'Already subscribed' }, { status: 409 })
  }

  // Compute amount
  const price = effectivePrice(strategy, input.plan)
  const expiresAt = input.plan === 'lifetime'
    ? null
    : new Date(
        Date.now() + (input.plan === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
      ).toISOString()

  // For paid strategies, return a payment intent instead of activating
  // (Plugs into existing crypto_payments flow.)
  if (price > 0) {
    return NextResponse.json({
      requires_payment: true,
      amount_usd:       price,
      plan:             input.plan,
      strategy_id:      input.strategy_id,
      // Frontend redirects to /dashboard/upgrade?strategy={id}&amount={price}
      payment_url: `/dashboard/upgrade?strategy=${input.strategy_id}&plan=${input.plan}`,
    })
  }

  // Free → activate immediately
  const { data: sub, error } = await supabase
    .from('strategy_subscriptions')
    .upsert({
      subscriber_id:   user.id,
      strategy_id:     input.strategy_id,
      plan:            input.plan,
      amount_paid_usd: 0,
      status:          'active',
      copy_enabled:    input.copy_enabled,
      copy_mode:       input.copy_mode,
      allocation_pct:  input.allocation_pct,
      risk_multiplier: input.risk_multiplier,
      max_lot_size:    input.max_lot_size,
      copy_sl:         input.copy_sl,
      copy_tp:         input.copy_tp,
      expires_at:      expiresAt,
    }, { onConflict: 'subscriber_id,strategy_id' })
    .select()
    .single()

  if (error) {
    console.error('subscribe error:', error)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }

  // Bump strategy subscriber count
  await supabase.rpc('toggle_follow', { p_leader_id: strategy.creator_id })
    .then(() => {/* best-effort auto-follow */})

  await supabase
    .from('published_strategies')
    .update({ subscribers_count: (strategy.subscribers_count ?? 0) + 1 })
    .eq('id', strategy.id)

  return NextResponse.json({ subscription: sub, status: 'active' })
}
