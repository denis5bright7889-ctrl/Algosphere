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
    features: ['3 AI signals / week', 'Trader Intelligence preview', 'Curated Telegram channels'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    features: [
      'AI signals across Forex, crypto, metals + commodities',
      'Behavioral Trade Journal (5 process grades + AI insights)',
      'Trader Intelligence dashboard (AI Trader Score)',
      'Curated Telegram signal channel',
      'Risk + position-size calculators',
      'Connect ONE broker (MT4/MT5/Binance/Bybit/OKX)',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Pro',
    price: 99,
    features: [
      'Everything in Starter',
      'Performance Intelligence (Sharpe / Sortino / drawdown clusters)',
      'AI Coach: streak-aware, pair-specific risk caps',
      'Strategy Lab — Quant Builder + Backtester + Optimization Center',
      'Deployment Readiness ladder (Research → Institutional)',
      'Smart-money + whale + sentiment + narrative engines',
      'Multi-broker connections + auto-import to journal',
      'WhatsApp + email + Web Push alerts',
      'FTMO-style prop-firm compliance tools',
    ],
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    price: 299,
    features: [
      'Everything in Pro',
      'Fully automated institutional AI execution engine',
      '15-gate institutional risk system (kill switch / cooldowns / DD)',
      'Automation Monitor (engine pulse + live positions + logs)',
      'On-Chain Intelligence terminal (whale / flows / liquidations)',
      'Institutional API access (/api/v1/decision)',
      'Enterprise: white-label + multi-user teams + sub-accounts',
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
