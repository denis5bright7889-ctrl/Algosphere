/**
 * Server-side effective-tier resolver.
 *
 * One source of truth for "what tier does the current request belong to"
 * — used by `<TierLock>` and other server components that need to gate
 * UI presentation by tier. Authoritative tier checks (signal edge,
 * payment-gated data) still go through `canAccess()` against the same
 * value; this helper just centralises the lookup so we don't recompute
 * the admin / beta / demo branches in every page.
 *
 * Cheap: one Supabase query (profiles row) per request. Pages that
 * already loaded the profile can pass their `tier` directly to
 * `<TierLock>` and skip this.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import type { SubscriptionTier } from '@/lib/types'

const TIERS: readonly SubscriptionTier[] = ['free', 'starter', 'premium', 'vip'] as const

export interface EffectiveTier {
  tier:        SubscriptionTier
  email:       string | null
  userId:      string | null
  /** True when the tier was granted by admin/beta/demo override (not paid). */
  isOverride:  boolean
}

export async function getEffectiveTier(): Promise<EffectiveTier> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email  = user?.email ?? null
  const userId = user?.id    ?? null
  if (!user) return { tier: 'free', email, userId, isOverride: false }

  if (isAdmin(email) || isBetaFreeAccessEnabled()) {
    return { tier: 'vip', email, userId, isOverride: true }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id)
    .single()

  const at = profile?.account_type
  if (at === 'demo_vip')     return { tier: 'vip',     email, userId, isOverride: true }
  if (at === 'demo_premium') return { tier: 'premium', email, userId, isOverride: true }

  const raw = profile?.subscription_tier
  if (raw && (TIERS as readonly string[]).includes(raw)) {
    return { tier: raw as SubscriptionTier, email, userId, isOverride: false }
  }
  return { tier: 'free', email, userId, isOverride: false }
}
