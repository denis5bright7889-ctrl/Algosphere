import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'

interface Props {
  params: Promise<{ plan: string }>
}

/**
 * Plan-entry route — used by every pricing CTA.
 *
 *   /demo/starter   → activate DEMO_STARTER (or instant-live for admin)
 *   /demo/premium   → activate DEMO_PREMIUM (or instant-live for admin)
 *   /demo/vip       → activate DEMO_VIP    (or instant-live for admin)
 *
 * Unauthenticated users are sent to /signup?next=/demo/<plan> first.
 *
 * SECURITY: Admin detection is done server-side via `isAdmin(user.email)`,
 * which reads ADMIN_EMAIL from process.env. A non-admin user cannot reach
 * the instant-activate branch by tampering with the client.
 */
export default async function DemoEntryPage({ params }: Props) {
  const { plan } = await params

  if (plan !== 'starter' && plan !== 'premium' && plan !== 'vip') {
    redirect('/pricing')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/signup?next=${encodeURIComponent(`/demo/${plan}`)}`)
  }

  // Look up current state
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_type, subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()

  // Refuse to overwrite an active paid subscription (idempotent re-entry is fine)
  if (
    profile?.subscription_tier && profile.subscription_tier !== 'free'
    && profile.subscription_status === 'active'
    && profile.subscription_tier === plan
  ) {
    redirect('/overview?already_subscribed=1')
  }

  // ─── Instant-activate ──────────────────────────────────────────────────────
  // Admin always bypasses. During the open-beta build phase, the
  // OPEN_BETA_FREE_ACCESS env flag also grants this path to every user so the
  // team can test end-to-end without paying. Both checks are server-side only.
  const instantActivate = isAdmin(user.email) || isBetaFreeAccessEnabled()

  if (instantActivate) {
    const periodEnd = new Date()
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await supabase
      .from('profiles')
      .update({
        subscription_tier:   plan,
        subscription_status: 'active',
        account_type:        'live',
        demo_plan:           null,
      })
      .eq('id', user.id)

    // Upsert a synthetic subscription row so analytics/admin views match
    await supabase
      .from('subscriptions')
      .upsert({
        user_id:               user.id,
        plan,
        status:                'active',
        current_period_end:    periodEnd.toISOString(),
        cancel_at_period_end:  false,
      }, { onConflict: 'user_id' })

    const reason = isAdmin(user.email) ? 'admin_activated' : 'beta_activated'
    redirect(`/overview?${reason}=${plan}`)
  }

  // ─── Regular users — demo sandbox ─────────────────────────────────────────
  const accountType =
    plan === 'starter' ? 'demo_starter' :
    plan === 'premium' ? 'demo_premium' :
                         'demo_vip'

  if (profile?.account_type !== accountType) {
    await supabase
      .from('profiles')
      .update({
        account_type:      accountType,
        demo_plan:         plan,
        demo_activated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
  }

  redirect(`/overview?demo_activated=${plan}`)
}
