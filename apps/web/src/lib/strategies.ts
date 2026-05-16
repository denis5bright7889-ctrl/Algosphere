/**
 * AlgoSphere Quant — Published strategy types & helpers
 */

export type StrategyStatus     = 'draft' | 'pending_review' | 'active' | 'suspended' | 'archived'
export type CopyMode           = 'signal_only' | 'semi_auto' | 'full_auto'
export type VerificationLevel  = 'none' | 'backtested' | 'live_30d' | 'live_90d' | 'live_180d'
export type TradingStyle       = 'scalping' | 'day' | 'swing' | 'position'
export type RiskApproach       = 'conservative' | 'moderate' | 'aggressive'
export type SubscriptionPlan   = 'free' | 'monthly' | 'annual' | 'lifetime'
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'paused'

export interface PublishedStrategy {
  id:                  string
  creator_id:          string
  name:                string
  slug:                string
  tagline:             string | null
  description:         string | null
  cover_image_url:     string | null
  asset_classes:       string[]
  pairs:               string[] | null
  timeframes:          string[]
  trading_style:       TradingStyle | null
  risk_approach:       RiskApproach | null
  win_rate:            number | null
  avg_rr:              number | null
  monthly_return_avg:  number | null
  max_drawdown:        number | null
  sharpe_ratio:        number | null
  total_signals:       number
  days_live:           number
  is_free:             boolean
  price_monthly:       number | null
  price_annual:        number | null
  price_lifetime:      number | null
  creator_revenue_pct: number
  platform_fee_pct:    number
  copy_enabled:        boolean
  copy_mode:           CopyMode
  profit_share_pct:    number
  min_copy_capital:    number
  verified:            boolean
  verification_level:  VerificationLevel
  status:              StrategyStatus
  published_at:        string | null
  subscribers_count:   number
  copy_followers_count: number
  total_revenue_usd:   number
  rating_avg:          number | null
  rating_count:        number
  created_at:          string
}

export interface StrategySubscription {
  id:              string
  subscriber_id:   string
  strategy_id:     string
  plan:            SubscriptionPlan
  amount_paid_usd: number
  status:          SubscriptionStatus
  copy_enabled:    boolean
  copy_mode:       CopyMode
  allocation_pct:  number
  risk_multiplier: number
  max_lot_size:    number | null
  copy_sl:         boolean
  copy_tp:         boolean
  hwm_basis:       number
  started_at:      string
  expires_at:      string | null
  cancelled_at:    string | null
}

// ─── Slug generation ────────────────────────────────────────
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

// ─── Pricing helpers ────────────────────────────────────────
export function effectivePrice(
  s: Pick<PublishedStrategy, 'is_free' | 'price_monthly' | 'price_annual' | 'price_lifetime'>,
  plan: SubscriptionPlan,
): number {
  if (s.is_free || plan === 'free') return 0
  switch (plan) {
    case 'monthly':  return s.price_monthly  ?? 0
    case 'annual':   return s.price_annual   ?? (s.price_monthly ? s.price_monthly * 12 * 0.8 : 0)
    case 'lifetime': return s.price_lifetime ?? 0
  }
}

// ─── Verification level labels ──────────────────────────────
export function verificationLevelLabel(level: VerificationLevel): string {
  switch (level) {
    case 'backtested': return 'Backtested'
    case 'live_30d':   return 'Live 30+ days'
    case 'live_90d':   return 'Live 90+ days'
    case 'live_180d':  return 'Live 6+ months'
    default:           return 'Unverified'
  }
}

// ─── Validation ─────────────────────────────────────────────
export function validateStrategyDraft(d: Partial<PublishedStrategy>): string | null {
  if (!d.name || d.name.length < 3 || d.name.length > 80)
    return 'Name must be 3-80 characters'
  if (d.tagline && d.tagline.length > 120)
    return 'Tagline must be ≤120 characters'
  if (d.description && d.description.length > 2000)
    return 'Description must be ≤2000 characters'
  if (!d.asset_classes || d.asset_classes.length === 0)
    return 'At least one asset class required'
  if (!d.is_free) {
    if (!d.price_monthly || d.price_monthly < 1)
      return 'Monthly price must be ≥$1 (or mark as free)'
  }
  return null
}
