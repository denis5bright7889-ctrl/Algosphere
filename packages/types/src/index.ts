// ============================================================
// Shared TypeScript types for AI Trading Hub
// ============================================================

// ------ Subscription ----------------------------------------

export type SubscriptionTier = 'free' | 'starter' | 'premium'
export type SubscriptionStatus = 'trialing' | 'active' | 'canceled' | 'past_due'

// ------ Profile ---------------------------------------------

export interface Profile {
  id: string
  full_name: string | null
  telegram_chat_id: number | null
  whatsapp_number: string | null
  subscription_tier: SubscriptionTier
  subscription_status: SubscriptionStatus | null
  stripe_customer_id: string | null
  created_at: string
}

// ------ Subscription record ---------------------------------

export interface Subscription {
  id: string
  user_id: string
  stripe_subscription_id: string | null
  plan: Omit<SubscriptionTier, 'free'>
  status: SubscriptionStatus
  current_period_end: string
  cancel_at_period_end: boolean
  created_at: string
}

// ------ Signal ----------------------------------------------

export type SignalDirection = 'buy' | 'sell'
export type SignalStatus = 'active' | 'closed' | 'cancelled'
export type SignalResult = 'win' | 'loss' | 'breakeven'

export interface Signal {
  id: string
  pair: string
  direction: SignalDirection
  entry_price: number | null
  stop_loss: number | null
  take_profit_1: number | null
  take_profit_2: number | null
  take_profit_3: number | null
  risk_reward: number | null
  status: SignalStatus
  result: SignalResult | null
  pips_gained: number | null
  tier_required: SubscriptionTier
  published_at: string
  created_by: string | null
}

// ------ Journal entry ---------------------------------------

export type SetupTag = 'breakout' | 'trend' | 'reversal' | 'range' | 'news' | string

export interface JournalEntry {
  id: string
  user_id: string
  pair: string | null
  direction: SignalDirection | null
  entry_price: number | null
  exit_price: number | null
  lot_size: number | null
  pips: number | null
  pnl: number | null
  risk_amount: number | null
  setup_tag: SetupTag | null
  notes: string | null
  screenshot_url: string | null
  trade_date: string | null
  created_at: string
}

// ------ Referral --------------------------------------------

export interface Referral {
  id: string
  referrer_id: string
  referred_id: string
  commission_pct: number
  commission_paid: boolean
  created_at: string
}

// ------ Plan config (mirrors lib/stripe/plans.ts) -----------

export interface Plan {
  id: SubscriptionTier
  name: string
  price: number
  features: string[]
  stripePriceId?: string
}

// ------ API response envelope -------------------------------

export interface ApiResponse<T = unknown> {
  data: T | null
  error: string | null
}
