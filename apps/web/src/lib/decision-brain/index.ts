/**
 * Decision Brain — the single source of trading-decision truth.
 *
 * Consolidation layer over the existing intelligence engines. Public
 * surface: composeDecision() (gather → build) plus the pure
 * buildMarketDecision(context) for testing/advanced composition.
 */
export { composeDecision, gatherDecisionContext, buildMarketDecision } from './engine'
export { W0, regimeAdaptedWeights, normalizeWeights } from './weights'
export type { BriefEngine, WeightVector } from './weights'
export {
  attributeEngines, updateWeights, summarizeReadiness, MIN_SAMPLES_TO_LEARN,
} from './learning'
export type { TrainingRecord, Outcome, ReadinessReport } from './learning'
export type { DecisionObject, DecisionContext, NormalizedSignal, StrictDecision } from './types'
export type {
  MarketState, MomentumState, FlowBias, Participation,
  RiskLevel, TradePermission, DirectionBias, TimeHorizon,
} from './config'
