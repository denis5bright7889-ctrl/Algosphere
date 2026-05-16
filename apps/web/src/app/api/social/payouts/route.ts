import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const MIN_PAYOUT_USD = 50

const schema = z.object({
  wallet_address: z.string().min(20).max(80),
  network:        z.enum(['TRC20','ERC20','BEP20']).default('TRC20'),
})

// ─── GET — list previous payout requests ─────────────────────
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('creator_payout_requests')
    .select('id, amount_usd, wallet_address, network, status, txid, processed_at, rejection_reason, created_at')
    .eq('creator_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ requests: data ?? [] })
}

// ─── POST — request a payout ─────────────────────────────────
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  // Aggregate all accrued earnings
  const { data: accrued } = await supabase
    .from('creator_earnings')
    .select('id, creator_usd')
    .eq('creator_id', user.id)
    .eq('status', 'accrued')

  if (!accrued || accrued.length === 0) {
    return NextResponse.json({ error: 'No accrued earnings to payout' }, { status: 400 })
  }

  const total = accrued.reduce((s, e) => s + Number(e.creator_usd ?? 0), 0)
  if (total < MIN_PAYOUT_USD) {
    return NextResponse.json(
      { error: `Minimum payout is $${MIN_PAYOUT_USD}. Current balance: $${total.toFixed(2)}` },
      { status: 400 },
    )
  }

  // Create payout request
  const earningIds = accrued.map(e => e.id)
  const { data: payout, error } = await supabase
    .from('creator_payout_requests')
    .insert({
      creator_id:     user.id,
      amount_usd:     total,
      wallet_address: parsed.data.wallet_address,
      network:        parsed.data.network,
      earning_ids:    earningIds,
      minimum_met:    true,
      status:         'pending',
    })
    .select()
    .single()

  if (error) {
    console.error('payout request error:', error)
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500 })
  }

  // Mark earnings as approved (pending payout processing)
  await supabase
    .from('creator_earnings')
    .update({ status: 'approved' })
    .in('id', earningIds)

  return NextResponse.json({
    request:    payout,
    amount_usd: total,
    message:    'Payout request submitted. Processing takes 1-3 business days.',
  })
}
