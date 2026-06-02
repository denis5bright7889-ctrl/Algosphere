import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { trackServer } from '@/lib/tracking/server'

/**
 * Attribute an OAuth signup to a referrer.
 *
 * Email signups are attributed by the handle_new_user() DB trigger (referral
 * code travels in user metadata). OAuth signups can't carry metadata the same
 * way, so the code comes back here as `?ref=`. This performs the same insert
 * idempotently using the service role (RLS allows only the referrer to SELECT;
 * the privileged insert mirrors the trigger).
 */
async function attributeOAuthReferral(userId: string, refCode: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  try {
    const db = serviceClient(url, key)

    // Already attributed? (trigger or a prior callback) — stop.
    const { data: existing } = await db
      .from('referrals')
      .select('id')
      .eq('referred_id', userId)
      .limit(1)
      .maybeSingle()
    if (existing) return

    const { data: referrer } = await db
      .from('profiles')
      .select('id')
      .eq('referral_code', refCode.toLowerCase())
      .limit(1)
      .maybeSingle()

    if (!referrer || referrer.id === userId) return // unknown code or self-referral

    await db.from('referrals').insert({
      referrer_id: referrer.id,
      referred_id: userId,
      status: 'signed_up',
    })
  } catch {
    // Attribution must never break the auth flow
  }
}

/**
 * Funnel-fire signup ONCE per user. Idempotency = look up the
 * growth_attribution_events table for any prior 'signup' row for
 * this user_id; insert only if none exists. Returning logins
 * therefore never duplicate the event.
 *
 * Visitor link is set on the next pageview tracker tick (the
 * /api/track/event upsert flips growth_visitors.user_id once the
 * visitor cookie + auth context land in the same request).
 */
async function fireSignupOnce(userId: string, visitorId: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    const db = serviceClient(url, key)
    const { count } = await db
      .from('growth_attribution_events')
      .select('id', { count: 'exact', head: true })
      .eq('event', 'signup')
      .eq('user_id', userId)
    if ((count ?? 0) > 0) return     // already fired (returning login)
    await trackServer({
      event:      'signup',
      userId,
      visitorId,
      source_kind: 'app',
    })
  } catch {
    /* never break auth */
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const ref = searchParams.get('ref')
  const next = searchParams.get('next') ?? '/overview'

  // Visitor cookie set by the edge proxy on first touch.
  const visitorId = request.cookies.get('__as_vid')?.value ?? null

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        if (ref) await attributeOAuthReferral(user.id, ref)
        // Fire-and-forget signup attribution. Idempotent — runs at
        // most once per user across the auth callback's lifetime.
        await fireSignupOnce(user.id, visitorId)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
