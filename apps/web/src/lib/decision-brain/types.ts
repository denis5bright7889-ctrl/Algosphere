/**
 * Decision Brain — types. Client-safe (no server imports), so the UI
 * card and the API both share the same DecisionObject contract.
 */
import type {
  EngineName, MarketState, MomentumState, FlowBias, Participation,
  RiskLevel, TradePermission, DirectionBias, TimeHorizon,
} from './config'

/**
 * The strict consolidated output. This is the ONLY thing the brain
 * exposes — no raw indicators, no engine internals.
 */
export interface DecisionObject {
  market_state:     MarketState
  momentum_state:   MomentumState
  flow_bias:        FlowBias
  participation:    Participation
  confidence:       number          // 0–100
  risk_level:       RiskLevel
  trade_permission: TradePermission
  direction_bias:   DirectionBias
  time_horizon:     TimeHorizon
  /** Market Decision Score — weighted Σ(engine_score × adaptive_weight), 0..1 (0.5 = neutral). */
  mds:              number
  explanation:      string[]         // short institutional reasoning lines
  /** Anti-copy strict projection — the ONLY shape external consumers get. */
  strict:           StrictDecision
}

/**
 * The strict, anti-copy decision object. No raw indicators, no engine
 * internals — states + abstract confidence only.
 */
export interface StrictDecision {
  mds:          number               // 0..1
  confidence:   number               // 0..1
  market_state: string
  trade_bias:   'LONG' | 'SHORT' | 'NONE'
  risk:         'LOW' | 'MEDIUM' | 'HIGH'
  action:       'ALLOW' | 'REDUCE' | 'AVOID'
}

/**
 * One engine's contribution after normalisation. `lean` is the directional
 * vote in [-1, +1] (negative = bearish / risk-off); `strength` is the
 * engine's own confidence in [0, 1]. Engines below the noise floor are
 * still recorded (for explanation) but excluded from the directional vote.
 */
export interface NormalizedSignal {
  engine:    EngineName
  available: boolean
  /** Does this engine express a market direction? (volatility/execution don't.) */
  directional: boolean
  lean:      number      // -1..+1
  strength:  number      // 0..1
  note:      string      // human descriptor for the explanation log
  /** Optional structured sub-dimensions specific to this engine.
   *  Surface via IntelligenceModule.data on the UI side. Examples:
   *    regime   → { environment, trend_strength, volatility_state, liquidity_state }
   *    momentum → { quality, phase, direction }
   *    breadth  → { advancers, decliners, breadth_score }
   *  Keep keys snake_case so the drawer can title-case them generically. */
  data?:     Record<string, string | number | boolean | null>
  /** Where this signal came from.
   *   'external'  — first-party engine read (default; omitted in legacy code)
   *   'heuristic' — internal cross-engine fallback when externals are down.
   *  The composer maps 'heuristic' to source_quality='fallback' and
   *  userStatus='fallback' so the user sees an honest read instead of
   *  the "recalibrating" placeholder when the external provider is out. */
  provenance?: 'external' | 'heuristic'
}

/**
 * Raw engine outputs gathered for one decision. Each may be null when the
 * engine is unavailable (provider down, no data) — the brain degrades
 * honestly rather than fabricating.
 */
export interface DecisionContext {
  signals:   NormalizedSignal[]
  /** Derived enum fields lifted from the richest available engine. */
  raw: {
    regimeState:    MarketState | null
    momentumState:  MomentumState | null
    flowBias:       FlowBias | null
    participation:  Participation | null
    volExtreme:     boolean
    volElevated:    boolean
    executionStable: boolean
    executionNote:  string
  }
  availableCount:  number
  generated_at:    string
}
