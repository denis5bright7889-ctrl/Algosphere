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

// ─── Trust composite ────────────────────────────────────────
/**
 * Transparent, deterministic trust score (0–100) for marketplace
 * ranking. NOT an opaque "AI score" — every input is a real,
 * inspectable column, and an unverified strategy with no engagement
 * scores genuinely low rather than defaulting to a flattering number.
 *
 * Weighting rationale:
 *   • Verification level dominates (max 55) — a 6-month live track
 *     record is the strongest trust signal we have.
 *   • Engagement (subscribers) is log-scaled (max ~22) so a few
 *     whales can't manufacture a top rank, and a brand-new strategy
 *     isn't buried forever.
 *   • Ratings contribute (max ~15) but only with enough reviews to
 *     matter (log-scaled count × normalised average).
 *   • Track-record depth (days_live + signals, max ~8) rewards
 *     longevity without letting it substitute for verification.
 */
const VERIFICATION_WEIGHT: Record<VerificationLevel, number> = {
  live_180d:  55,
  live_90d:   42,
  live_30d:   28,
  backtested: 10,
  none:       0,
}

export function trustScore(
  s: Pick<PublishedStrategy,
    'verification_level' | 'subscribers_count' | 'rating_avg' |
    'rating_count' | 'days_live' | 'total_signals'>,
): number {
  const verification = VERIFICATION_WEIGHT[s.verification_level] ?? 0

  // log1p so the curve flattens — diminishing returns past a point.
  const engagement = Math.min(22, Math.log1p(Math.max(0, s.subscribers_count)) * 4)

  const ratings =
    s.rating_count > 0 && s.rating_avg != null
      ? Math.min(15, (s.rating_avg / 5) * Math.log1p(s.rating_count) * 5)
      : 0

  const depth = Math.min(
    8,
    Math.log1p(Math.max(0, s.days_live)) * 1.2 +
      Math.log1p(Math.max(0, s.total_signals)) * 0.8,
  )

  return Math.round(
    Math.max(0, Math.min(100, verification + engagement + ratings + depth)),
  )
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
