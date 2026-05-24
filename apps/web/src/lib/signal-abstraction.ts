/**
 * Signal abstraction — the strategy-opacity boundary (Phase 2).
 *
 * The `signals` table carries engine internals that must NEVER cross the
 * API boundary: raw indicator values (`feature_snapshot`), the component
 * sub-scores that reveal orchestration structure (`der_score`,
 * `entropy_score`, `liquidity_score`, `momentum_score`, `trend_score`,
 * `volatility_score`, `rr_score`, `quality_score`), model versioning
 * (`engine_version`), internal notes/authorship, and the raw
 * `strategy_id`.
 *
 * Every signal sent to a client — dashboard server components, the
 * authenticated REST API, copy fan-out metadata — goes through
 * `toPublicSignal()`. The frontend receives ONLY: price levels, a single
 * composite confidence, an abstracted quality BAND (not the raw number),
 * coarse regime/session labels, execution status, outcome, and an opaque
 * strategy ALIAS. There is no field on PublicSignal from which engine
 * internals or weights can be reconstructed.
 *
 * This is a whitelist, not a blacklist: PublicSignal enumerates exactly
 * what may leave the server, so schema drift cannot accidentally widen
 * the surface.
 */

/** Fields that exist on the signals row but must never be serialized. */
export const INTERNAL_SIGNAL_FIELDS = [
  'feature_snapshot', 'der_score', 'entropy_score', 'liquidity_score',
  'momentum_score', 'trend_score', 'volatility_score', 'rr_score',
  'quality_score', 'engine_version', 'admin_notes', 'created_by',
  'strategy_id',
] as const

export type QualityBand = 'A' | 'B' | 'C' | 'D'

export interface PublicSignal {
  id:             string
  pair:           string
  direction:      string
  entry_price:    number | null
  stop_loss:      number | null
  take_profit_1:  number | null
  take_profit_2:  number | null
  take_profit_3:  number | null
  risk_reward:    number | null
  /** Final composite confidence (0–100). Component scores are hidden. */
  confidence:     number | null
  /** Abstracted from the raw quality score — band only, never the value. */
  quality_band:   QualityBand | null
  /** Coarse market-regime label (e.g. "trend", "range"). */
  regime:         string | null
  session:        string | null
  /** Opaque alias (AQ-XXXX). The real strategy_id never leaves the server. */
  strategy:       string
  status:         string
  lifecycle_state:string
  result:         string | null
  pips_gained:    number | null
  tier_required:  string
  tags:           string[] | null
  published_at:   string
  invalidated_at: string | null
}

/** Structural input — the subset of the signals row the DTO reads. */
export interface SignalRowInput {
  id:              string
  pair:            string
  direction:       string
  entry_price?:    number | null
  stop_loss?:      number | null
  take_profit_1?:  number | null
  take_profit_2?:  number | null
  take_profit_3?:  number | null
  risk_reward?:    number | null
  confidence_score?: number | null
  quality_score?:  number | null
  regime?:         string | null
  session?:        string | null
  strategy_id?:    string | null
  status?:         string | null
  lifecycle_state?:string | null
  result?:         string | null
  pips_gained?:    number | null
  tier_required?:  string | null
  tags?:           string[] | null
  published_at?:   string | null
  invalidated_at?: string | null
}

/** Stable, dependency-free 32-bit FNV-1a hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Deterministic opaque alias for a strategy. House/admin signals
 * (strategy_id null) map to the AQ-CORE composite. Real UUIDs map to a
 * stable AQ-XXXX token — same strategy always shows the same alias, but
 * the token is one-way (a hash, not the id).
 */
export function strategyAlias(strategyId: string | null | undefined): string {
  if (!strategyId) return 'AQ-CORE'
  const token = fnv1a(strategyId).toString(36).toUpperCase().padStart(4, '0').slice(-4)
  return `AQ-${token}`
}

/** Coarse quality band from the hidden raw score. Null when unscored. */
export function qualityBand(score: number | null | undefined): QualityBand | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 50) return 'C'
  return 'D'
}

/** Project a raw signals row onto the safe public shape. */
export function toPublicSignal(row: SignalRowInput): PublicSignal {
  return {
    id:              row.id,
    pair:            row.pair,
    direction:       row.direction,
    entry_price:     row.entry_price     ?? null,
    stop_loss:       row.stop_loss        ?? null,
    take_profit_1:   row.take_profit_1    ?? null,
    take_profit_2:   row.take_profit_2    ?? null,
    take_profit_3:   row.take_profit_3    ?? null,
    risk_reward:     row.risk_reward      ?? null,
    confidence:      row.confidence_score ?? null,
    quality_band:    qualityBand(row.quality_score),
    regime:          row.regime           ?? null,
    session:         row.session          ?? null,
    strategy:        strategyAlias(row.strategy_id),
    status:          row.status           ?? 'active',
    lifecycle_state: row.lifecycle_state  ?? 'published',
    result:          row.result           ?? null,
    pips_gained:     row.pips_gained      ?? null,
    tier_required:   row.tier_required    ?? 'starter',
    tags:            row.tags             ?? null,
    published_at:    row.published_at     ?? new Date(0).toISOString(),
    invalidated_at:  row.invalidated_at   ?? null,
  }
}

/** Map a batch, tolerating a loosely-typed supabase result. */
export function toPublicSignals(rows: unknown): PublicSignal[] {
  if (!Array.isArray(rows)) return []
  return (rows as SignalRowInput[]).map(toPublicSignal)
}

// ── Tier-scoped fidelity (Phase 3) ──────────────────────────────────────
//
// "Different tiers expose different abstraction levels." Access is decided
// per signal (viewer tier vs the signal's tier_required), not globally —
// so the unit is a redactor over the signal row, applied server-side.

/** The tradeable edge — nulled when the viewer lacks tier access. */
export const EDGE_FIELDS = [
  'entry_price', 'stop_loss', 'take_profit_1', 'take_profit_2',
  'take_profit_3', 'risk_reward', 'confidence_score', 'quality_score',
] as const

/**
 * Server-side tier redaction for the dashboard feed. A locked signal
 * (viewer tier < tier_required) keeps its card metadata — pair, direction,
 * tier_required, timing — so the upsell card still renders, but the actual
 * edge (entry/SL/TP/RR/confidence) is removed from the payload entirely.
 *
 * Previously the only gate was a `blur-sm` CSS class in SignalCard, so the
 * real numbers shipped in the RSC payload and were trivially readable in
 * devtools. This makes the gate authoritative. Accessible signals pass
 * through untouched, so entitled viewers see no change.
 */
export function redactLockedSignal<T extends object>(row: T, hasAccess: boolean): T {
  if (hasAccess) return row
  return {
    ...row,
    entry_price: null, stop_loss: null,
    take_profit_1: null, take_profit_2: null, take_profit_3: null,
    risk_reward: null, confidence_score: null, quality_score: null,
  } as T
}
