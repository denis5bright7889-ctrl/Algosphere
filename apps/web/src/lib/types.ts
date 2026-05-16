// =============================================================================
// AlgoSphere Quant — Shared Type Definitions
// =============================================================================

// ------ Subscription --------------------------------------------------------
export type SubscriptionTier = 'free' | 'starter' | 'premium' | 'vip'
export type SubscriptionStatus = 'trialing' | 'active' | 'canceled' | 'past_due'

// ------ Profile -------------------------------------------------------------
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

// ------ Subscription record -------------------------------------------------
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

// ------ Signal lifecycle ----------------------------------------------------
export type SignalDirection = 'buy' | 'sell'
export type SignalStatus = 'active' | 'closed' | 'cancelled'
export type SignalResult = 'win' | 'loss' | 'breakeven'
export type SignalRegime = 'trending' | 'ranging' | 'volatile' | 'dead' | 'breakout' | 'compression'
export type TradingSession = 'asian' | 'london' | 'new_york' | 'london_ny' | 'off_hours'
export type SignalLifecycleState =
  | 'pending' | 'queued' | 'active'
  | 'tp1_hit' | 'tp2_hit' | 'tp3_hit'
  | 'stopped' | 'invalidated' | 'expired' | 'breakeven'

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
  // Institutional fields
  lifecycle_state: SignalLifecycleState
  strategy_id: string | null
  confidence_score: number | null   // 0–100
  quality_score: number | null      // 0–10
  regime: SignalRegime | null
  session: TradingSession | null
  trend_score: number | null
  momentum_score: number | null
  liquidity_score: number | null
  rr_score: number | null
  volatility_score: number | null
  tp1_hit_at: string | null
  tp2_hit_at: string | null
  tp3_hit_at: string | null
  stopped_at: string | null
  admin_notes: string | null
  tags: string[]
}

// ------ Strategy registry ---------------------------------------------------
export interface Strategy {
  id: string
  name: string
  display_name: string
  description: string | null
  timeframes: string[]
  instruments: string[]
  active: boolean
  created_at: string
}

export interface StrategyPerformance {
  strategy_id: string
  name: string
  display_name: string
  total_signals: number
  closed_signals: number
  wins: number
  losses: number
  breakevens: number
  win_rate_pct: number
  avg_quality_score: number | null
  avg_confidence: number | null
  avg_win_pips: number | null
  avg_loss_pips: number | null
  avg_rr: number | null
}

// ------ Journal entry -------------------------------------------------------
export type SetupTag = 'breakout' | 'trend' | 'reversal' | 'range' | 'news' | 'scalp' | string

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

// ------ Advanced analytics --------------------------------------------------
export interface PerformanceMetrics {
  sharpe_ratio: number
  sortino_ratio: number
  max_drawdown_pct: number
  max_drawdown_usd: number
  calmar_ratio: number
  expectancy: number
  profit_factor: number
  avg_win: number
  avg_loss: number
  win_rate: number
  total_trades: number
  total_pnl: number
  best_trade: number
  worst_trade: number
  consecutive_wins: number
  consecutive_losses: number
}

export interface DrawdownPoint {
  date: string
  equity: number
  drawdown_pct: number
}

// ------ API keys ------------------------------------------------------------
export interface ApiKey {
  id: string
  user_id: string
  name: string
  key_prefix: string
  permissions: string[]
  rate_limit_per_minute: number
  last_used_at: string | null
  expires_at: string | null
  revoked: boolean
  created_at: string
}

// ------ Execution logs ------------------------------------------------------
export interface ExecutionLog {
  id: string
  signal_id: string | null
  user_id: string
  order_type: 'market' | 'limit' | 'stop'
  direction: SignalDirection
  symbol: string
  requested_price: number
  fill_price: number | null
  requested_lots: number
  filled_lots: number | null
  slippage_pips: number | null
  spread_at_entry: number | null
  status: 'pending' | 'filled' | 'partial' | 'rejected' | 'cancelled' | 'timeout'
  rejection_reason: string | null
  broker_name: string | null
  latency_ms: number | null
  requested_at: string
  filled_at: string | null
  realized_pnl: number | null
  realized_pips: number | null
}

// ------ Payments ------------------------------------------------------------
export type PaymentStatus =
  | 'awaiting_payment' | 'pending_review' | 'approved' | 'rejected' | 'expired'

export interface CryptoPayment {
  id: string
  user_id: string
  plan: 'starter' | 'premium'
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

// ------ Plan config ---------------------------------------------------------
// Crypto-only payments — no Stripe price IDs. The tier catalog lives in
// `@/lib/plans` and gating reads `profiles.subscription_tier`, which the
// crypto admin-approval flow writes.
export interface Plan {
  id: SubscriptionTier
  name: string
  price: number
  features: string[]
}

// ------ API response envelope -----------------------------------------------
export interface ApiResponse<T = unknown> {
  data: T | null
  error: string | null
}
