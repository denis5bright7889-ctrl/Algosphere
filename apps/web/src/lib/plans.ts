/**
 * Tier catalog — the single source of truth for plan names, prices and
 * features. Decoupled from any payment provider: AlgoSphere Quant is
 * crypto-only (USDT-TRC20 + BTC/ETH/Binance Pay), so there are no Stripe
 * price IDs here. The crypto admin-approval flow writes
 * `profiles.subscription_tier`, and every gate reads from there.
 */
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
    features: [
      'Forex, crypto & commodities signals',
      'Basic AI trade alerts + Telegram channel',
      'Trading dashboard & win/loss + PnL stats',
      'Trading Journal Lite (notes, tags, review)',
      'Risk & position-size calculators',
      'Connect ONE exchange / MT5 (read-only)',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Pro',
    price: 99,
    features: [
      'Everything in Starter',
      'Verified analytics: equity curve, Sharpe, drawdown',
      'Advanced AI signals + multi-timeframe confluence',
      'Trading Journal PRO (mistake AI, replay, grading)',
      'Smart-money / whale / sentiment intelligence',
      'WhatsApp + email + push alerts',
      'FTMO-style prop-firm tools',
      'Multi-exchange semi-automated execution',
    ],
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    price: 299,
    features: [
      'Everything in Pro',
      'Fully automated institutional AI execution engine',
      'Hedge-fund risk system (kill switch, cooldowns, DD)',
      'Live execution dashboard (positions, health, logs)',
      'Copy-trading: follow, publish, earn commissions',
      'Crypto intelligence terminal (whale, flows, on-chain)',
      'Institutional signal consensus engine',
      'Enterprise: white-label, API, teams & sub-accounts',
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
