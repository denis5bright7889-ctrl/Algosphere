import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'

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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const ref = searchParams.get('ref')
  const next = searchParams.get('next') ?? '/overview'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (ref) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) await attributeOAuthReferral(user.id, ref)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
