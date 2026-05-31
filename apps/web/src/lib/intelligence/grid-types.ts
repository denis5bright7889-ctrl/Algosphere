/**
 * Analyze-Mode intelligence grid — shared contract.
 *
 * Client-safe (pure types, no server imports) so the grid UI and the
 * /api/intelligence/grid route share one shape.
 *
 * Reliability layer (Founder directive — Market Intelligence Reliability
 * Upgrade): the grid surface NEVER exposes raw provider errors. Every
 * module carries a sanitized `reasoning` string, a `source_quality`
 * grade, an honest `freshness` label and a `userStatus` enum. The raw
 * `insight` is preserved for admin diagnostics but display layers must
 * use `reasoning` for users.
 */

export type ModuleStatus = 'bullish' | 'bearish' | 'neutral' | 'unavailable'

/** Honest engine availability — the user-facing taxonomy. Replaces the
 *  old single 'unavailable' bucket that surfaced as "Awaiting" in the UI. */
export type UserStatus =
  | 'live'        // current data, primary source
  | 'degraded'    // current data, fallback / lower confidence source
  | 'stale'       // cached from a prior successful read; still useful
  | 'fallback'    // internal heuristic produced this (no external data)
  | 'building'    // genuine cold start — engine has never produced data

/** Source-quality tier the engine's data came from. Drives the pill on
 *  the card so the user sees how to weight the read. */
export type SourceQuality = 'high' | 'medium' | 'low' | 'fallback'


export interface IntelligenceModule {
  /** Decision-Brain engine key (regime, smartMoney, …). */
  key:         string
  /** Display title for the card header. */
  name:        string
  status:      ModuleStatus
  /** Honest user-facing availability state. Use this for UI, not
   *  `available` alone. */
  userStatus:  UserStatus
  /** 0–100, the engine's own strength. */
  confidence:  number
  /** -1..+1 directional vote (negative = bearish/risk-off). Real. */
  lean:        number
  /** False for risk-only engines (volatility, execution) — no lean. */
  directional: boolean
  available:   boolean
  /**
   * RAW engine note. May contain provider error strings ("Nansen 403:
   * Insufficient credits", "fetch failed: ECONNREFUSED"). Never render
   * this to users — it's preserved for admin diagnostics only.
   */
  insight:     string
  /**
   * SANITIZED user-facing reasoning. Either the engine's own clean
   * descriptor or a canonical fallback sentence. Provider names + HTTP
   * codes + credit/quota wording are stripped at the composer.
   */
  reasoning:   string
  /** Tier of the upstream source. */
  source_quality: SourceQuality
  /** Human-readable freshness — "just now", "12m ago", "2h ago". */
  freshness:   string
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
  /** % of engines returning live OR degraded data (not stale/building). */
  coverage:        number
  /** % of engines whose data is high or medium source quality. */
  reliability:     number
  /** Overall data-quality grade for the read. */
  data_quality:    'high' | 'medium' | 'low'
}

export interface GridPayload {
  verdict:        GridVerdict
  modules:        IntelligenceModule[]
  /** How many engines actually had data this pass. */
  availableCount: number
  generatedAt:    string
}
