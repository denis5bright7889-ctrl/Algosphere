/**
 * /api/leads — capture an email-only lead with optional UTM attribution.
 *
 * Idempotent: if the email already exists, we upsert any new attribution
 * fields but do NOT re-send the welcome email (welcome_sent_at acts as
 * the idempotency token).
 *
 * Welcome email fires fire-and-forget — a Resend outage must never
 * block the lead from being persisted.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { sendWelcomeEmail } from '@/lib/email/welcome'

export const dynamic = 'force-dynamic'

const schema = z.object({
  email:        z.string().email().max(200),
  name:         z.string().max(120).optional(),
  source:       z.string().max(60).optional(),
  utm_source:   z.string().max(60).optional(),
  utm_medium:   z.string().max(60).optional(),
  utm_campaign: z.string().max(80).optional(),
  utm_content:  z.string().max(80).optional(),
  referrer:     z.string().max(500).optional(),
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
  const { email, name, source, utm_source, utm_medium, utm_campaign, utm_content, referrer } = parsed.data

  const db = svc()

  // Read existing row (if any) so we know whether to send the welcome.
  const { data: existing } = await db
    .from('leads')
    .select('id, welcome_sent_at')
    .eq('email', email)
    .maybeSingle()

  // Upsert — never overwrites existing welcome_sent_at; new attribution
  // wins (last touch). `ignoreDuplicates` is intentionally NOT set so
  // attribution updates flow through.
  const { error } = await db
    .from('leads')
    .upsert({
      email,
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      referrer,
    }, { onConflict: 'email' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fire welcome only on first touch. Stamp welcome_sent_at so any
  // future submission idempotently skips. Best-effort — never blocks
  // the success response.
  if (!existing?.welcome_sent_at) {
    sendWelcomeEmail({ to: email, name, eventType: 'lead.welcome' })
      .then(async (res) => {
        if (res.ok) {
          await db.from('leads')
            .update({ welcome_sent_at: new Date().toISOString() })
            .eq('email', email)
        }
      })
      .catch(() => { /* swallow — welcome is best-effort */ })
  }

  return NextResponse.json({ ok: true })
}
