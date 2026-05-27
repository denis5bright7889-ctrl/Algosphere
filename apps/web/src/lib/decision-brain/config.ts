/**
 * Decision Brain — configuration.
 *
 * All weighting, thresholds, and gating live here as DATA, not inline
 * magic numbers, so the institutional logic is tunable without touching
 * the decision code. The engine reads these; it never hardcodes the
 * numbers in branch conditions.
 *
 * Client-safe (pure constants + types) so the UI card can import the
 * enums without dragging in server-only composers.
 */

export type EngineName =
  | 'regime' | 'momentum' | 'breadth' | 'smartMoney'
  | 'whaleFlow' | 'dominance' | 'volatility' | 'correlation' | 'execution'

/**
 * Directional + risk weights. Direction-bearing engines contribute to the
 * net lean; volatility/execution are risk-only (weight 0 for direction,
 * handled by the risk + override paths). Weights are relative — the engine
 * normalises by the sum of *available* directional weights so missing
 * engines don't silently bias the result.
 */
export const DECISION_CONFIG = {
  /** Direction weighting — only engines that express a market lean. */
  directionWeights: {
    momentum:   0.24,
    regime:     0.20,
    breadth:    0.18,
    smartMoney: 0.16,
    whaleFlow:  0.12,
    dominance:  0.10,
  } as Record<Extract<EngineName, 'momentum'|'regime'|'breadth'|'smartMoney'|'whaleFlow'|'dominance'>, number>,

  thresholds: {
    /** Net |confidence| above which a directional bias is asserted. */
    minConfidenceToAllow: 55,
    /** Below this, trade_permission can be at most REDUCE. */
    reduceBelow:          55,
    /** Below this, trade_permission is AVOID. */
    avoidBelow:           35,
    /** Confidence points removed per detected major contradiction. */
    contradictionPenalty: 18,
    /** Engine strength below this is treated as NOISE and excluded from the vote. */
    noiseFloor:           0.12,
    /** Net |lean| below this → direction_bias NEUTRAL regardless of confidence. */
    neutralBand:          0.12,
    /** Share of scanned symbols at High volatility for "extreme" classification. */
    extremeVolShare:      0.5,
    elevatedVolShare:     0.3,
    /** % advancing below = narrow participation. */
    narrowParticipationPct: 40,
    decliningParticipationPct: 30,
  },

  /** Engines whose ABSENCE caps overall confidence (they're load-bearing). */
  criticalEngines: ['regime', 'breadth'] as EngineName[],
  /** Confidence ceiling applied when a critical engine is unavailable. */
  criticalMissingCeiling: 45,
  /** Confidence ceiling when contradictions are present (anti-blind-average). */
  contradictionCeiling: 50,

  /**
   * Disagreement penalties for the brief's confidence = 1 − Σ(penalty)
   * model. Each fires at most once. Subtracted from a base of 1.0.
   */
  penalties: {
    smartMoneyVsMomentum: 0.25,
    whaleVsMomentum:      0.20,
    regimeInstability:    0.30,
    volSpikeNoParticipation: 0.15,
    correlationBreakdown: 0.10,
  },
  /** Strict-output confidence ladder (0..1). */
  strictThresholds: {
    allowAbove:  0.65,
    reduceAbove: 0.45,
    /** |mds − 0.5| above which a directional trade_bias is asserted. */
    biasBand:    0.06,
  },
} as const

export type MarketState     = 'RISK_ON' | 'RISK_OFF' | 'TRANSITION' | 'UNCERTAIN'
export type MomentumState    = 'ACCUMULATION' | 'EXPANSION' | 'TRENDING' | 'PARABOLIC' | 'EXHAUSTION'
export type FlowBias         = 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL'
export type Participation     = 'BROAD' | 'NARROW' | 'DECLINING'
export type RiskLevel         = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
export type TradePermission   = 'ALLOW' | 'REDUCE' | 'AVOID'
export type DirectionBias     = 'LONG' | 'SHORT' | 'NEUTRAL'
export type TimeHorizon       = 'SCALP' | 'INTRADAY' | 'SWING' | 'UNCERTAIN'
