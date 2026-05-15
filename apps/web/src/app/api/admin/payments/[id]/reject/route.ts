import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { z } from 'zod'

const schema = z.object({
  reason: z.string().min(5, 'Please provide a rejection reason').max(500),
})

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
  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: payment } = await db
    .from('crypto_payments')
    .select('id, status')
    .eq('id', id)
    .single()

  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  if (payment.status !== 'pending_review') {
    return NextResponse.json(
      { error: `Cannot reject — payment status is: ${payment.status}` },
      { status: 409 }
    )
  }

  const { error } = await db.from('crypto_payments').update({
    status: 'rejected',
    admin_note: parsed.data.reason,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, message: 'Payment rejected.' })
}
