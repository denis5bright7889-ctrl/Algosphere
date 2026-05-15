import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'

const TXID_REGEX = /^[a-fA-F0-9]{60,80}$/

const schema = z.object({
  payment_id: z.string().uuid(),
  txid: z
    .string()
    .min(60, 'TRC20 TXIDs are at least 60 characters')
    .max(80, 'TXID too long')
    .regex(TXID_REGEX, 'Invalid TRC20 TXID format — must be hex characters only'),
  amount_sent: z.number().positive('Amount must be positive'),
  sender_wallet: z.string().min(10).max(100).optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const { payment_id, txid, amount_sent, sender_wallet } = parsed.data
  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch the payment — must belong to this user and be awaiting
  const { data: payment } = await db
    .from('crypto_payments')
    .select('id, user_id, status, amount_usd, expires_at')
    .eq('id', payment_id)
    .eq('user_id', user.id)
    .single()

  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  if (payment.status !== 'awaiting_payment') {
    return NextResponse.json(
      { error: `Cannot submit proof — payment is already in status: ${payment.status}` },
      { status: 409 }
    )
  }
  if (new Date(payment.expires_at) < new Date()) {
    await db.from('crypto_payments').update({ status: 'expired' }).eq('id', payment_id)
    return NextResponse.json({ error: 'This payment has expired. Please create a new one.' }, { status: 410 })
  }

  // Duplicate TXID check across entire table
  const { data: dupTx } = await db
    .from('crypto_payments')
    .select('id')
    .eq('txid', txid)
    .maybeSingle()

  if (dupTx) {
    return NextResponse.json(
      { error: 'This TXID has already been submitted. Contact support if this is an error.' },
      { status: 409 }
    )
  }

  // Amount sanity check — warn if clearly wrong, but let admin decide
  const amountOk = amount_sent >= payment.amount_usd * 0.98 // allow 2% dust tolerance
  const amountNote = amountOk ? null : `Amount sent ($${amount_sent}) is less than required ($${payment.amount_usd}).`

  const updatePayload: Record<string, unknown> = {
    txid,
    status: 'pending_review',
    admin_note: amountNote,
  }
  if (sender_wallet) updatePayload.sender_wallet = sender_wallet

  const { error } = await db
    .from('crypto_payments')
    .update(updatePayload)
    .eq('id', payment_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, message: 'Proof submitted. Admin will verify within 24 hours.' })
}
