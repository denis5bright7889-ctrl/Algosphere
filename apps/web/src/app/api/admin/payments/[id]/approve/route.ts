import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { commissionFor } from '@/lib/referrals'
import { z } from 'zod'

const schema = z.object({ note: z.string().max(500).optional() })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { note } = schema.parse(body)

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch payment — must be pending_review
  const { data: payment } = await db
    .from('crypto_payments')
    .select('id, user_id, plan, status, txid')
    .eq('id', id)
    .single()

  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  if (payment.status !== 'pending_review') {
    return NextResponse.json(
      { error: `Cannot approve — payment status is: ${payment.status}` },
      { status: 409 }
    )
  }

  // Activate subscription
  const planTier = payment.plan as 'starter' | 'premium' | 'vip'
  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  const [approveResult, profileResult, subResult] = await Promise.all([
    db.from('crypto_payments').update({
      status: 'approved',
      admin_note: note ?? null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id),

    db.from('profiles').update({
      subscription_tier:   planTier,
      subscription_status: 'active',
      // Demo → live conversion: clear sandbox flags
      account_type:        'live',
      demo_converted_at:   new Date().toISOString(),
    }).eq('id', payment.user_id),

    db.from('subscriptions').upsert({
      user_id: payment.user_id,
      plan: planTier,
      status: 'active',
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: false,
    }, { onConflict: 'user_id' }),
  ])

  if (approveResult.error) return NextResponse.json({ error: approveResult.error.message }, { status: 500 })

  // ─── Referral conversion (best-effort, never blocks approval) ──────────────
  // If this user signed up via a referral and hasn't converted yet, accrue the
  // affiliate commission off this first paid plan.
  try {
    const { data: ref } = await db
      .from('referrals')
      .select('id, commission_pct, status')
      .eq('referred_id', payment.user_id)
      .eq('status', 'signed_up')
      .maybeSingle()

    if (ref) {
      await db
        .from('referrals')
        .update({
          status:            'converted',
          plan:              planTier,
          commission_amount: commissionFor(planTier, ref.commission_pct ?? 20),
          converted_at:      new Date().toISOString(),
        })
        .eq('id', ref.id)
    }
  } catch {
    // Commission accrual is non-critical — approval already succeeded
  }

  return NextResponse.json({ ok: true, message: `Payment approved — ${planTier} plan activated.` })
}
