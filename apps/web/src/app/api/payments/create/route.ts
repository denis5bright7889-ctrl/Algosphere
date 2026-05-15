import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { BINANCE_CONFIG, PLAN_PRICES_USD } from '@/lib/payments/binance'

const schema = z.object({
  plan: z.enum(['starter', 'premium', 'vip']),
})

export async function POST(request: NextRequest) {
  if (!BINANCE_CONFIG.enabled) {
    return NextResponse.json({ error: 'Crypto payments are not enabled.' }, { status: 503 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid plan' }, { status: 422 })

  const { plan } = parsed.data
  const amount_usd = PLAN_PRICES_USD[plan]!

  // Block if user already has an active/pending payment for this plan
  const { data: existing } = await supabase
    .from('crypto_payments')
    .select('id, status, expires_at')
    .eq('user_id', user.id)
    .eq('plan', plan)
    .in('status', ['awaiting_payment', 'pending_review'])
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'You already have a pending payment for this plan.', payment_id: existing.id },
      { status: 409 }
    )
  }

  // Use service client to read wallet address server-side only
  let walletAddress: string
  try {
    walletAddress = BINANCE_CONFIG.walletAddress
  } catch {
    return NextResponse.json({ error: 'Payment address not configured.' }, { status: 503 })
  }

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await db
    .from('crypto_payments')
    .insert({
      user_id: user.id,
      plan,
      amount_usd,
      currency: BINANCE_CONFIG.token,
      network: BINANCE_CONFIG.network,
      wallet_address: walletAddress,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    payment_id: data.id,
    wallet_address: walletAddress,
    amount_usd,
    currency: BINANCE_CONFIG.token,
    network: BINANCE_CONFIG.network,
    plan,
    expires_at: data.expires_at,
  })
}
