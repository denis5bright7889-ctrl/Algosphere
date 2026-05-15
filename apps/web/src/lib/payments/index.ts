// Payment abstraction — currently BINANCE-only mode
// All other providers are disabled. Re-enable by adding provider config here.

export { BINANCE_CONFIG, PLAN_PRICES_USD } from './binance'
export type { CryptoPayment, PaymentStatus } from './binance'

export const ACTIVE_PAYMENT_PROVIDER = 'BINANCE' as const

export function getSubscriptionStatus(
  tier: string,
  status: string | null
): { isActive: boolean; canAccessPaidFeatures: boolean } {
  const isActive = status === 'active' || status === 'trialing'
  const canAccessPaidFeatures = isActive && tier !== 'free'
  return { isActive, canAccessPaidFeatures }
}
