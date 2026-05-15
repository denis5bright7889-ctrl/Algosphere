import type { Plan } from '@/lib/types'

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free Trial',
    price: 0,
    features: ['3 signals/week', 'Dashboard preview', 'Telegram community'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    stripePriceId: process.env.STRIPE_STARTER_PRICE_ID!,
    features: [
      'Daily AI signals',
      'Forex + Commodities',
      'Risk dashboard',
      'Trade journal',
      'Telegram bot alerts',
      'Basic analytics',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Pro',
    price: 99,
    stripePriceId: process.env.STRIPE_PREMIUM_PRICE_ID!,
    features: [
      'Everything in Starter',
      'Crypto signals',
      'Full analytics suite',
      'AI performance insights',
      'WhatsApp alerts',
      'Priority support',
      'Advanced risk tools',
      'Portfolio tracking',
    ],
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    price: 299,
    stripePriceId: process.env.STRIPE_VIP_PRICE_ID!,
    features: [
      'Everything in Pro',
      'VIP institutional signals',
      'Copy-trading integrations (MT5, cTrader, Binance)',
      'Private Telegram group',
      'Personal risk advisor AI',
      'Multi-account tracking',
      'API access',
      'Dedicated support',
      'Early access features',
    ],
  },
}

export const TIER_ORDER: Record<string, number> = {
  free:    0,
  starter: 1,
  premium: 2,
  vip:     3,
}

export function canAccessTier(userTier: string, requiredTier: string): boolean {
  return (TIER_ORDER[userTier] ?? 0) >= (TIER_ORDER[requiredTier] ?? 0)
}
