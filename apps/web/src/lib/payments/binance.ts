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
