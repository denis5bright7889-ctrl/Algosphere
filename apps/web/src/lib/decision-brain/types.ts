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
  explanation:      string[]         // short institutional reasoning lines
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
