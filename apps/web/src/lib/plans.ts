/**
 * Tier catalog — the single source of truth for plan names, prices and
 * features. Decoupled from any payment provider: AlgoSphere Quant is
 * crypto-only (USDT-TRC20 + BTC/ETH/Binance Pay), so there are no Stripe
 * price IDs here. The crypto admin-approval flow writes
 * `profiles.subscription_tier`, and every gate reads from there.
 *
 * LAUNCH PHASE — Pro / VIP are "Coming soon" so Starter is the only
 * accessible tier and includes every feature. The Pro / VIP entries
 * below are intentionally PRESERVED (prices, features) so the catalog
 * is one-line restore away when those plans launch. The pricing UI
 * locks them and PLAN_PRICES_USD keeps their numbers for the eventual
 * payment flow.
 */
import type { Plan } from '@/lib/types'

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    features: ['Full Starter access (launch phase)'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    // Catalog price preserved at $29 for marketing context.
    // Launch phase: access is granted free to every signed-in user —
    // see lib/entitlements.ts tierIncludes() and the upgrade UI which
    // shows "Free during launch" instead of a payment CTA.
    price: 29,
    features: [
      'AI signals across Forex, crypto, metals + commodities',
      'Behavioral Trade Journal (5 process grades + AI insights)',
      'Trader Intelligence dashboard (AI Trader Score)',
      'Curated Telegram signal channel',
      'Risk + position-size calculators',
      'Connect any broker (MT4/MT5/Binance/Bybit/OKX/OANDA/cTrader)',
      'Performance Intelligence (Sharpe / Sortino / drawdown clusters)',
      'AI Coach: streak-aware, pair-specific risk caps',
      'Strategy Lab — Quant Builder + Backtester + Optimization Center',
      'Deployment Readiness ladder (Research → Institutional)',
      'Smart-money + whale + sentiment + narrative engines',
      'WhatsApp + email + Web Push alerts',
      'FTMO-style prop-firm compliance tools',
      'Fully automated institutional AI execution engine',
      '15-gate institutional risk system (kill switch / cooldowns / DD)',
      'Automation Monitor (engine pulse + live positions + logs)',
      'On-Chain Intelligence terminal (whale / flows / liquidations)',
      'Institutional API access (/api/v1/decision)',
    ],
  },
  // Pro / VIP — preserved verbatim. UI surfaces them as "Coming soon"
  // and refuses to create payment sessions; the catalog stays valid so
  // PLAN_PRICES_USD, crypto checkout, and downstream admin flows keep
  // working when the plans launch.
  premium: {
    id: 'premium',
    name: 'Pro',
    price: 99,
    features: [
      'Everything in Starter',
      'Coming soon — priority signals delivery',
      'Coming soon — dedicated Pro-tier strategy library',
      'Coming soon — concierge onboarding + 1:1 office hours',
    ],
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    price: 299,
    features: [
      'Everything in Pro',
      'Coming soon — white-label + multi-user teams + sub-accounts',
      'Coming soon — bespoke strategy research desk',
      'Coming soon — institutional support SLA',
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
