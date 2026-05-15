import type { SubscriptionTier } from '@/lib/types'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'

export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) return false
  return email.toLowerCase() === adminEmail.toLowerCase()
}

// Admin always has VIP-level access. During closed beta (OPEN_BETA_FREE_ACCESS),
// every signed-in user is treated as VIP server-side so the whole platform is
// testable without payment. NOTE: isBetaFreeAccessEnabled() reads a non-public
// env var, so it is always false on the client — these overrides only take
// effect in Server Components / route handlers, which is the intended trust
// boundary.
export function effectiveTier(
  email: string | undefined | null,
  tier: SubscriptionTier
): SubscriptionTier {
  if (isAdmin(email) || isBetaFreeAccessEnabled()) return 'vip'
  return tier
}

export function canAccess(
  email: string | undefined | null,
  userTier: SubscriptionTier,
  requiredTier: SubscriptionTier
): boolean {
  if (isAdmin(email) || isBetaFreeAccessEnabled()) return true
  const order: Record<SubscriptionTier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }
  return (order[userTier] ?? 0) >= (order[requiredTier] ?? 0)
}
