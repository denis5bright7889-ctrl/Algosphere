/**
 * Trader Type Classification — 8 archetypes captured at onboarding.
 *
 * Drives three downstream behaviours:
 *   1. Risk-profile defaults (SL %, position-size suggestions)
 *   2. Strategy recommendations (matched via strategy tags)
 *   3. Dashboard customization (panel order, default timeframe)
 *
 * Persisted on `profiles.trader_type` (enum) + `profiles.classification_meta`
 * (JSONB of the raw wizard answers).
 */

export type TraderType =
  | 'scalper'
  | 'day_trader'
  | 'swing_trader'
  | 'position_trader'
  | 'algorithmic_trader'
  | 'copy_trader'
  | 'prop_firm_trader'
  | 'arbitrage_trader'

export const TRADER_TYPES: TraderType[] = [
  'scalper', 'day_trader', 'swing_trader', 'position_trader',
  'algorithmic_trader', 'copy_trader', 'prop_firm_trader', 'arbitrage_trader',
]

export interface TraderArchetype {
  key:          TraderType
  label:        string
  blurb:        string
  /** Typical hold duration — used by the wizard to back-propose a type. */
  holdDuration: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months'
  /** Risk-profile defaults applied when the user lands on /risk for the first time. */
  defaultStopLossPct:  number     // e.g. 0.002 = 0.2% of price
  defaultRiskPerTrade: number     // e.g. 0.01 = 1% of equity
  /** Default chart timeframe for /execution / /signals. */
  defaultTimeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w'
  /** Strategy categories from signal_engine that match this archetype. */
  strategyTags: string[]
}

export const ARCHETYPES: Record<TraderType, TraderArchetype> = {
  scalper: {
    key: 'scalper',
    label: 'Scalper',
    blurb: 'Holds positions for seconds to minutes. Targets many small wins per session.',
    holdDuration: 'minutes',
    defaultStopLossPct:  0.001,    // 10 pips on a major
    defaultRiskPerTrade: 0.0025,   // 0.25% per trade — high frequency
    defaultTimeframe: '1m',
    strategyTags: ['momentum', 'liquidity_grab', 'orderflow', 'breakout_micro'],
  },
  day_trader: {
    key: 'day_trader',
    label: 'Day Trader',
    blurb: 'Opens and closes within the same session. No overnight exposure.',
    holdDuration: 'hours',
    defaultStopLossPct:  0.003,
    defaultRiskPerTrade: 0.01,
    defaultTimeframe: '15m',
    strategyTags: ['trend_pullback', 'breakout', 'mean_reversion', 'session_open'],
  },
  swing_trader: {
    key: 'swing_trader',
    label: 'Swing Trader',
    blurb: 'Holds for several days to a couple of weeks. Catches multi-day moves.',
    holdDuration: 'days',
    defaultStopLossPct:  0.015,
    defaultRiskPerTrade: 0.015,
    defaultTimeframe: '4h',
    strategyTags: ['trend_continuation', 'reversal_swing', 'macro_event'],
  },
  position_trader: {
    key: 'position_trader',
    label: 'Position Trader',
    blurb: 'Long-horizon, holds weeks to months. Lower frequency, larger conviction.',
    holdDuration: 'months',
    defaultStopLossPct:  0.05,
    defaultRiskPerTrade: 0.02,
    defaultTimeframe: '1d',
    strategyTags: ['macro_trend', 'fundamental_driven', 'cycle_position'],
  },
  algorithmic_trader: {
    key: 'algorithmic_trader',
    label: 'Algorithmic Trader',
    blurb: 'Runs automated strategies. Builds or subscribes to signal engines.',
    holdDuration: 'minutes',
    defaultStopLossPct:  0.003,
    defaultRiskPerTrade: 0.01,
    defaultTimeframe: '5m',
    strategyTags: ['quant', 'signal_following', 'systematic'],
  },
  copy_trader: {
    key: 'copy_trader',
    label: 'Copy Trader',
    blurb: 'Mirrors trades from verified traders. Hands-off allocation.',
    holdDuration: 'hours',
    defaultStopLossPct:  0.005,    // follows leader's SL, this is just a safety cap
    defaultRiskPerTrade: 0.01,
    defaultTimeframe: '1h',
    strategyTags: ['copy_following', 'leader_select'],
  },
  prop_firm_trader: {
    key: 'prop_firm_trader',
    label: 'Prop Firm Trader',
    blurb: 'Trades a funded account. Hard drawdown/daily-loss limits.',
    holdDuration: 'hours',
    defaultStopLossPct:  0.002,    // tight — drawdown rules dominate
    defaultRiskPerTrade: 0.005,
    defaultTimeframe: '15m',
    strategyTags: ['risk_first', 'trend_pullback', 'liquidity_grab'],
  },
  arbitrage_trader: {
    key: 'arbitrage_trader',
    label: 'Arbitrage Trader',
    blurb: 'Captures price differences across venues. Fast execution + low latency.',
    holdDuration: 'seconds',
    defaultStopLossPct:  0.0005,
    defaultRiskPerTrade: 0.005,
    defaultTimeframe: '1m',
    strategyTags: ['cross_exchange', 'triangular', 'latency_arb'],
  },
}

/** Wizard answers — raw form what the user clicked. Persisted as JSONB. */
export interface ClassificationAnswers {
  /** "How long do you typically hold a position?" */
  hold_duration: TraderArchetype['holdDuration']
  /** "How active do you want to be?" */
  activity: 'very_active' | 'active' | 'moderate' | 'passive'
  /** "Do you want strategies executed automatically?" */
  automation: 'manual' | 'semi_auto' | 'fully_auto'
  /** "Capital source / context?" */
  capital_source: 'personal' | 'prop_firm' | 'managed' | 'experiment'
}

/**
 * Best-guess trader type from the wizard answers. Deterministic rules,
 * not a model — small input space. Caller can still let the user override.
 */
export function classify(a: ClassificationAnswers): TraderType {
  if (a.capital_source === 'prop_firm') return 'prop_firm_trader'
  if (a.automation === 'fully_auto')    return a.capital_source === 'managed' ? 'copy_trader' : 'algorithmic_trader'
  if (a.hold_duration === 'seconds')    return a.activity === 'very_active' ? 'arbitrage_trader' : 'scalper'
  if (a.hold_duration === 'minutes')    return 'scalper'
  if (a.hold_duration === 'hours')      return 'day_trader'
  if (a.hold_duration === 'days')       return 'swing_trader'
  if (a.hold_duration === 'weeks' || a.hold_duration === 'months') return 'position_trader'
  return 'day_trader'
}

/** Convenience getter — returns the day_trader default if no type is set. */
export function archetypeOf(type?: TraderType | null): TraderArchetype {
  if (type && ARCHETYPES[type]) return ARCHETYPES[type]
  return ARCHETYPES.day_trader
}
