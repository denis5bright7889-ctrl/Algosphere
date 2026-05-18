import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { effectiveTierForFeatures } from '@/lib/demo'
import { intelEntitlements, type IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { SubscriptionTier } from '@/lib/types'

/**
 * Server guard shared by every Intelligence page. Returns the
 * effective tier + entitlements. Redirects unauthenticated users.
 * FREE is NOT blocked — the brief wants delayed/limited, not denied.
 */
export async function loadIntelContext(): Promise<{
  tier: SubscriptionTier
  ent:  IntelEntitlements
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id).single()
  const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  const tier    = effectiveTierForFeatures(user.email, rawTier, profile?.account_type)
  return { tier, ent: intelEntitlements(tier) }
}
