/**
 * Analyze-Mode intelligence grid — server composer.
 *
 * Reuses the Decision Brain's existing consolidation: one
 * `gatherDecisionContext()` pass runs every engine (regime, momentum,
 * breadth, smart money, whale flow, dominance, volatility, correlation,
 * execution), and `buildMarketDecision()` derives the consolidated
 * verdict from the SAME context — so the grid and the verdict can never
 * disagree, and we pay for the engines only once.
 *
 * Each engine's `NormalizedSignal` (available / lean / strength / note)
 * maps 1:1 to an `IntelligenceModule`. Nothing is fabricated: unavailable
 * engines are flagged so the card renders honestly.
 */
import 'server-only'
import {
  gatherDecisionContext, buildMarketDecision, type NormalizedSignal,
} from '@/lib/decision-brain'
import { DECISION_CONFIG } from '@/lib/decision-brain/config'
import type {
  GridPayload, IntelligenceModule, ModuleStatus,
} from './grid-types'

// Display names for the Bloomberg-style card headers.
const NAME: Record<string, string> = {
  regime:      'Market Regime',
  momentum:    'Momentum',
  breadth:     'Market Breadth',
  smartMoney:  'Smart Money',
  whaleFlow:   'Whale Flows',
  dominance:   'Dominance & Rotation',
  volatility:  'Volatility',
  correlation: 'Correlations',
  execution:   'Execution Quality',
}

// Stable display order — directional engines first (decision-bearing),
// then the risk-only engines (volatility, execution) last.
const ORDER = [
  'regime', 'momentum', 'breadth', 'smartMoney', 'whaleFlow',
  'dominance', 'correlation', 'volatility', 'execution',
]

function statusOf(s: NormalizedSignal): ModuleStatus {
  if (!s.available) return 'unavailable'
  if (!s.directional) return 'neutral'           // vol/execution carry no lean
  const band = DECISION_CONFIG.thresholds.neutralBand
  if (s.lean >  band) return 'bullish'
  if (s.lean < -band) return 'bearish'
  return 'neutral'
}

function toModule(s: NormalizedSignal, generatedAt: string): IntelligenceModule {
  return {
    key:         s.engine,
    name:        NAME[s.engine] ?? s.engine,
    status:      statusOf(s),
    confidence:  Math.round((s.strength ?? 0) * 100),
    lean:        s.lean ?? 0,
    directional: s.directional,
    available:   s.available,
    insight:     s.note,
    updatedAt:   generatedAt,
  }
}

export async function composeIntelligenceGrid(): Promise<GridPayload> {
  const ctx = await gatherDecisionContext()
  const decision = buildMarketDecision(ctx)

  const byKey = new Map<string, NormalizedSignal>(ctx.signals.map((s) => [s.engine, s]))
  const ordered = [
    ...ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!),
    ...ctx.signals.filter((s) => !ORDER.includes(s.engine)),
  ]

  return {
    verdict: {
      marketState:     decision.market_state,
      directionBias:   decision.direction_bias,
      confidence:      decision.confidence,
      riskLevel:       decision.risk_level,
      tradePermission: decision.trade_permission,
      mds:             decision.mds,
      explanation:     decision.explanation,
    },
    modules:        ordered.map((s) => toModule(s, ctx.generated_at)),
    availableCount: ctx.availableCount,
    generatedAt:    ctx.generated_at,
  }
}
