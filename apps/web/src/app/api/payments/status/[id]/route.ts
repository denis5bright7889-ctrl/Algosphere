import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: payment } = await supabase
    .from('crypto_payments')
    .select('id, plan, amount_usd, currency, network, status, admin_note, expires_at, created_at, txid')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })

  // Expire stale awaiting_payment records on read
  if (payment.status === 'awaiting_payment' && new Date(payment.expires_at) < new Date()) {
    await supabase
      .from('crypto_payments')
      .update({ status: 'expired' })
      .eq('id', id)
    return NextResponse.json({ ...payment, status: 'expired' })
  }

  return NextResponse.json(payment)
}
