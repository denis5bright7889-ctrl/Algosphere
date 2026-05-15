/**
 * AlgoSphere Quant — Demo Access Layer
 *
 * Demo mode gives users UI access to Starter/Pro features with simulated
 * data, WITHOUT granting real subscription entitlement. Real payment,
 * live broker, and live execution are never unlocked by demo state.
 *
 * Use these helpers everywhere instead of directly inspecting account_type
 * strings.
 */
import { isAdmin } from '@/lib/admin'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import type { SubscriptionTier } from '@/lib/types'

export type AccountType = 'live' | 'demo_starter' | 'demo_premium' | 'demo_vip'

export const DEMO_ACCOUNT_TYPES: AccountType[] = ['demo_starter', 'demo_premium', 'demo_vip']

export function isDemo(accountType: string | null | undefined): boolean {
  return accountType === 'demo_starter'
      || accountType === 'demo_premium'
      || accountType === 'demo_vip'
}

export function isLive(accountType: string | null | undefined): boolean {
  return !accountType || accountType === 'live'
}

/** The subscription tier a demo account simulates. Returns null for live accounts. */
export function demoTier(accountType: string | null | undefined): 'starter' | 'premium' | 'vip' | null {
  if (accountType === 'demo_starter') return 'starter'
  if (accountType === 'demo_premium') return 'premium'
  if (accountType === 'demo_vip')     return 'vip'
  return null
}

/**
 * Effective tier for UI/feature gating. Demo accounts get their simulated tier;
 * admin still bypasses to vip; otherwise real subscription wins.
 *
 * IMPORTANT: This function MUST NOT be used to gate live-only operations
 * (real payments, real broker, withdrawals). Use `canPerformLiveAction()`
 * for those.
 */
export function effectiveTierForFeatures(
  email: string | null | undefined,
  subscriptionTier: SubscriptionTier,
  accountType: string | null | undefined,
): SubscriptionTier {
  // Admin + closed-beta both unlock everything (server-side only — the beta
  // flag is a non-public env var so this is false on the client).
  if (isAdmin(email) || isBetaFreeAccessEnabled()) return 'vip'
  const demo = demoTier(accountType)
  if (demo) return demo
  return subscriptionTier
}

/**
 * Strict check for actions that touch real money / real broker / real execution.
 * Demo accounts ALWAYS return false here regardless of simulated tier.
 */
export function canPerformLiveAction(
  email: string | null | undefined,
  subscriptionTier: SubscriptionTier,
  accountType: string | null | undefined,
  requiredTier: SubscriptionTier = 'starter',
): boolean {
  // Demo accounts can never perform live actions
  if (isDemo(accountType)) return false
  // Admin bypass remains (admin is a live owner of the platform)
  if (isAdmin(email)) return true
  const order: Record<SubscriptionTier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }
  return (order[subscriptionTier] ?? 0) >= (order[requiredTier] ?? 0)
}

/** Human-readable label for the demo state, for banners and badges. */
export function demoLabel(accountType: string | null | undefined): string {
  if (accountType === 'demo_starter') return 'Demo: Starter Plan'
  if (accountType === 'demo_premium') return 'Demo: Pro Plan'
  if (accountType === 'demo_vip')     return 'Demo: VIP Plan'
  return ''
}
