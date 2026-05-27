/**
 * Decision Brain — the single source of trading-decision truth.
 *
 * Consolidation layer over the existing intelligence engines. Public
 * surface: composeDecision() (gather → build) plus the pure
 * buildMarketDecision(context) for testing/advanced composition.
 */
export { composeDecision, gatherDecisionContext, buildMarketDecision } from './engine'
export type { DecisionObject, DecisionContext, NormalizedSignal } from './types'
export type {
  MarketState, MomentumState, FlowBias, Participation,
  RiskLevel, TradePermission, DirectionBias, TimeHorizon,
} from './config'
