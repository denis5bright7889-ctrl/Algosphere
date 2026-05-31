/**
 * Market Intelligence reliability — pure-function half.
 *
 * Sanitization + freshness + source-quality + user-status helpers.
 * No I/O, no global state — safe to import from anywhere (tests,
 * client, server). The in-memory cache lives in a sibling
 * `reliability-cache.ts` that IS server-only because it depends on
 * shared process state.
 *
 * Rule of the file: NEVER let provider names, HTTP codes, credit/
 * quota wording, or words like "Awaiting" / "Unavailable" / "Excluded
 * from vote" reach a user-facing string. Anything that smells like a
 * raw error is replaced with a canonical per-engine fallback sentence.
 */
import type {
  SourceQuality, UserStatus,
} from './grid-types'


// ─── Cache TTLs per the founder spec ────────────────────────────────

/** Per-engine cache lifetime (ms). After this, a missing engine drops
 *  to 'building' instead of returning stale. */
const TTL_MS: Record<string, number> = {
  regime:      15 * 60_000,
  momentum:    15 * 60_000,
  breadth:     15 * 60_000,
  smartMoney:  30 * 60_000,
  whaleFlow:   30 * 60_000,
  dominance:   30 * 60_000,
  correlation: 60 * 60_000,
  volatility:  15 * 60_000,
  execution:   15 * 60_000,
}
const DEFAULT_TTL_MS = 30 * 60_000

/** Per-engine canonical "no data yet" reasoning. NEVER references a
 *  provider name — the user shouldn't know we tried Nansen first. */
const FALLBACK_REASONING: Record<string, string> = {
  regime:      'Regime classification is still warming up. Trend, volatility and breadth reads should converge shortly.',
  momentum:    'Momentum data is recalibrating across timeframes. Strength + persistence will surface on the next read.',
  breadth:     'Market breadth is being recomputed across the universe. Participation reads return on the next pass.',
  smartMoney:  'Large-wallet positioning data is recalibrating across sources. Read will resume on the next cycle.',
  whaleFlow:   'Whale flow inference is updating. Exchange in/out and large-transfer clusters return on the next cycle.',
  dominance:   'Dominance and rotation reads are recomputing. Capital concentration shifts return on the next cycle.',
  correlation: 'Cross-asset correlations are recomputing across the BTC / ETH / DXY / Gold / SP500 / NDX panel.',
  volatility:  'Volatility regime is recalibrating across the universe. Stress and ATR percentile return shortly.',
  execution:   'Execution health telemetry is refreshing — spread, slippage and depth normalize across symbols.',
}

const DEFAULT_FALLBACK_REASONING =
  'This engine is recalibrating. The read will resume on the next cycle — confidence intentionally low until it does.'


// ─── Sanitization ─────────────────────────────────────────────────

/** Provider names that must NEVER appear in user-facing reasoning. */
const PROVIDER_NAMES = [
  'nansen', 'glassnode', 'arkham', 'coinmetrics', 'santiment',
  'whalealert', 'whale alert', 'whalebot',
  'twelvedata', 'twelve data', 'finnhub', 'polygon',
  'alphavantage', 'alpha vantage', 'binance', 'coinbase',
]

/** Patterns that scream "this is a raw provider error string". */
const ERROR_PATTERNS: RegExp[] = [
  /\bhttp\s*[45]\d\d\b/i,                  // HTTP 403 / HTTP 500
  /\b[45]\d\d:\s*/,                         // 403: / 503:
  /insufficient\s+credits?/i,
  /credits?\s+exhausted/i,
  /credits?\s+remaining/i,
  /rate[\s-]?limit/i,
  /quota\s+exceeded/i,
  /unauthorized/i,
  /forbidden/i,
  /econnrefused/i,
  /timeout/i,
  /fetch\s+failed/i,
  /failed\s+to\s+fetch/i,
  /not\s+configured/i,
  /api[\s-]?key\s+(missing|invalid)/i,
  /unavailable/i,
  /awaiting/i,
  /excluded\s+from\s+vote/i,
]

/**
 * Decide whether the engine's raw `note` is safe to show users.
 * Returns true when the note is clean (institutional reasoning),
 * false when it leaks provider errors / credits / HTTP codes / etc.
 */
export function isCleanReasoning(note: string | null | undefined): boolean {
  if (!note) return false
  const t = note.trim()
  if (t.length < 5) return false
  const lower = t.toLowerCase()
  for (const name of PROVIDER_NAMES) {
    if (lower.includes(name)) return false
  }
  for (const re of ERROR_PATTERNS) {
    if (re.test(t)) return false
  }
  return true
}

/**
 * Return a user-facing reasoning string. If the raw note is clean we
 * pass it through; otherwise we substitute the engine's canonical
 * fallback. Never leaks provider names or error wording.
 */
export function sanitizeReasoning(engine: string, rawNote: string): string {
  if (isCleanReasoning(rawNote)) return rawNote
  return FALLBACK_REASONING[engine] ?? DEFAULT_FALLBACK_REASONING
}


// ─── Source quality + user status ─────────────────────────────────

/**
 * Map an engine's availability + strength + age to a source-quality
 * tier. Live high-confidence data is 'high'; available-but-thin is
 * 'medium'; explicitly fallback / heuristic is 'fallback'.
 */
export function deriveSourceQuality(args: {
  available:      boolean
  strength01:     number   // engine's own confidence in [0, 1]
  ageMs:          number   // 0 for fresh; >TTL for stale
  ttlMs:          number
  /** True when the read came from an internal cross-engine heuristic.
   *  Always returns 'fallback' regardless of strength — we never claim
   *  a heuristic match institutional-grade provider confidence. */
  fromHeuristic?: boolean
}): SourceQuality {
  if (args.fromHeuristic) return 'fallback'
  if (!args.available) return 'fallback'
  if (args.ageMs > args.ttlMs / 2) return 'low'
  if (args.strength01 >= 0.7) return 'high'
  if (args.strength01 >= 0.4) return 'medium'
  return 'low'
}

/** Honest user-facing status taxonomy. */
export function deriveUserStatus(args: {
  available:      boolean
  fromCache:      boolean
  /** True when the read came from an internal cross-engine heuristic
   *  rather than a first-party provider — surfaces as 'fallback'. */
  fromHeuristic?: boolean
  ageMs:          number
  ttlMs:          number
}): UserStatus {
  if (args.fromHeuristic && args.available) return 'fallback'
  if (args.available && !args.fromCache) return 'live'
  if (args.fromCache && args.ageMs <= args.ttlMs) return 'stale'
  if (args.fromCache && args.ageMs > args.ttlMs)  return 'building'
  return 'building'
}


// ─── Freshness label ──────────────────────────────────────────────

/** "just now", "12m ago", "2h ago", "3d ago". Pure. */
export function freshnessLabel(updatedAtIso: string): string {
  const t = new Date(updatedAtIso).getTime()
  if (!Number.isFinite(t)) return 'just now'
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 30)    return 'just now'
  if (sec < 60)    return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60)    return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24)     return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}


/** TTL for an engine (with sensible default). */
export function ttlFor(engine: string): number {
  return TTL_MS[engine] ?? DEFAULT_TTL_MS
}
