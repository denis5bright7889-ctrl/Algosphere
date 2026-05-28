/**
 * Analyze-Mode intelligence grid — shared contract.
 *
 * Client-safe (pure types, no server imports) so the grid UI and the
 * /api/intelligence/grid route share one shape. Every module is a real
 * normalized signal from the Decision Brain (`gatherDecisionContext`) —
 * no fabricated series, no placeholder numbers. Unavailable engines are
 * marked honestly so the card can render "—" instead of inventing data.
 */

export type ModuleStatus = 'bullish' | 'bearish' | 'neutral' | 'unavailable'

export interface IntelligenceModule {
  /** Decision-Brain engine key (regime, smartMoney, …). */
  key:         string
  /** Display title for the card header. */
  name:        string
  status:      ModuleStatus
  /** 0–100, the engine's own strength. */
  confidence:  number
  /** -1..+1 directional vote (negative = bearish/risk-off). Real. */
  lean:        number
  /** False for risk-only engines (volatility, execution) — no lean. */
  directional: boolean
  available:   boolean
  /** One-line institutional descriptor (the engine's own note). */
  insight:     string
  updatedAt:   string
}

export interface GridVerdict {
  marketState:     string
  directionBias:   string
  /** 0–100 consolidated confidence. */
  confidence:      number
  riskLevel:       string
  tradePermission: string
  /** Market Decision Score 0..1 (0.5 = neutral). */
  mds:             number
  explanation:     string[]
}

export interface GridPayload {
  verdict:        GridVerdict
  modules:        IntelligenceModule[]
  /** How many engines actually had data this pass. */
  availableCount: number
  generatedAt:    string
}
