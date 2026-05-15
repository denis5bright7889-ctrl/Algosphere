// Binance USDT TRC20 payment configuration
// Wallet address is never embedded in client bundles — always fetched from /api/payments/create

export const BINANCE_CONFIG = {
  enabled: process.env.BINANCE_PAYMENT_ENABLED === 'true',
  network: 'TRC20' as const,
  token: 'USDT' as const,
  // Only accessible server-side
  get walletAddress(): string {
    const addr = process.env.BINANCE_USDT_TRC20_ADDRESS
    if (!addr) throw new Error('BINANCE_USDT_TRC20_ADDRESS is not configured')
    return addr
  },
}

export const PLAN_PRICES_USD: Record<string, number> = {
  starter: 29,
  premium: 99,
  vip:     299,
}

export type BillingInterval = 'monthly' | 'annual'

/** Annual = 12 months at a 20% discount, whole-dollar rounded. */
export const ANNUAL_DISCOUNT_PCT = 20

export function annualPrice(plan: string): number {
  const monthly = PLAN_PRICES_USD[plan] ?? 0
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100))
}

/** Authoritative amount for a (plan, interval). Never trust a client-sent total. */
export function priceFor(plan: string, interval: BillingInterval): number {
  return interval === 'annual' ? annualPrice(plan) : (PLAN_PRICES_USD[plan] ?? 0)
}

/** Dollars saved per year by choosing annual over 12× monthly. */
export function annualSavings(plan: string): number {
  const monthly = PLAN_PRICES_USD[plan] ?? 0
  return monthly * 12 - annualPrice(plan)
}

export type PaymentStatus =
  | 'awaiting_payment'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'expired'

export interface CryptoPayment {
  id: string
  user_id: string
  plan: 'starter' | 'premium' | 'vip'
  billing_interval: BillingInterval
  amount_usd: number
  currency: string
  network: string
  wallet_address: string
  txid: string | null
  screenshot_url: string | null
  status: PaymentStatus
  admin_note: string | null
  reviewed_at: string | null
  expires_at: string
  created_at: string
}
