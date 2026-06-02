/**
 * /api/newsletter/subscribe — explicit opt-in newsletter signup.
 *
 * Distinct from /api/leads (which is a soft email capture). This
 * endpoint is what a "Subscribe to the AlgoSphere newsletter" toggle
 * hits — consent is explicit, and the row is tracked separately so
 * the weekly digest sender knows which addresses opted in.
 *
 * MVP: single-opt-in (no double-opt-in email click yet). Re-submitting
 * with the same email resets status to 'subscribed' if it was
 * 'unsubscribed'. Status='pending' is reserved for the eventual
 * double-opt-in flow.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { sendWelcomeEmail } from '@/lib/email/welcome'

export const dynamic = 'force-dynamic'

const schema = z.object({
  email:  z.string().email().max(200),
  name:   z.string().max(120).optional(),
  source: z.string().max(60).optional(),
})

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 422 })
  }
  const { email, name, source } = parsed.data

  const db = svc()

  const { data: existing } = await db
    .from('newsletter_subscribers')
    .select('id, status, confirmed_at')
    .eq('email', email)
    .maybeSingle()

  // MVP single-opt-in: go straight to 'subscribed'. When double-opt-in
  // lands, change default to 'pending' and fire a confirmation email
  // that flips status on click.
  const { error } = await db
    .from('newsletter_subscribers')
    .upsert({
      email,
      status:          'subscribed',
      confirmed_at:    existing?.confirmed_at ?? new Date().toISOString(),
      unsubscribed_at: null,
      source,
    }, { onConflict: 'email' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Send the same welcome template for first-time subscribers. The
  // welcome covers both lead and newsletter contexts — narrower
  // sequence templates land in Phase 3 Stage 2.
  if (!existing) {
    sendWelcomeEmail({ to: email, name, eventType: 'newsletter.welcome' })
      .catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
