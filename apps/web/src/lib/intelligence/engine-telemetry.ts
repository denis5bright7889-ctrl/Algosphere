/**
 * Market Intelligence — engine telemetry (server-only, admin-only).
 *
 * Captures per-engine outcomes from `composeIntelligenceGrid()` so the
 * admin observability page can show:
 *
 *   - Provider health   (success / fail / fallback rates per engine)
 *   - Fallback activation (how often each engine falls to cache or
 *                          building / what % the cache is carrying)
 *   - Recent failures   (sanitized error class; never raw provider
 *                        strings — ops can read the original at the
 *                        engine logs, but the telemetry surface stays
 *                        clean for screenshot/share)
 *   - Cache hit rate    (per engine, last N events)
 *
 * Per the admin-vs-user rule the data captured here MUST NEVER reach
 * a user-facing route. The /api/admin/intelligence-health endpoint
 * gates on `isAdmin(user.email)`; the consumer is the
 * /admin/intelligence-health page (also admin-gated).
 *
 * Storage: in-process ring buffer (last 500 events). Same caveat as
 * the reliability cache — autoscaled deployments need a shared store
 * (Redis); migration is mechanical when needed.
 */
import 'server-only'

/** Outcome of a single engine resolution within one grid build. */
export type EngineOutcome =
  | 'live'        // engine returned current data → fresh module
  | 'stale'       // engine unavailable, served last successful from cache
  | 'heuristic'   // engine unavailable, served internal cross-engine model
  | 'building'    // engine unavailable, no cache, no heuristic → placeholder

/** Sanitized error class — never includes provider names or raw API
 *  payloads. Picked by classifyError() from the raw engine note. */
export type ErrorClass =
  | 'rate_limit'
  | 'credits_exhausted'
  | 'auth_failure'
  | 'timeout'
  | 'connection_refused'
  | 'http_5xx'
  | 'http_4xx'
  | 'config_missing'
  | 'no_data'
  | 'partial_data'
  | 'other'


export interface EngineEvent {
  /** ISO timestamp of when the resolution happened. */
  at:           string
  engine:       string
  outcome:      EngineOutcome
  /** Source quality the composer assigned to this resolution. */
  source_quality: 'high' | 'medium' | 'low' | 'fallback'
  /** Optional sanitized error class — present when outcome != 'live'
   *  and the raw note carried a recognizable failure pattern. */
  error_class?: ErrorClass
  /** Optional cache age (ms) at the moment of the resolution.
   *  Populated when outcome='stale'. */
  cache_age_ms?: number
}


/** Aggregate read for the admin page — one row per engine. */
export interface EngineHealthRow {
  engine:           string
  events_seen:      number
  /** % of events with outcome='live' over the window. */
  live_rate_pct:    number
  /** % with outcome='stale'. */
  stale_rate_pct:   number
  /** % with outcome='heuristic' — internal model carrying the engine. */
  heuristic_rate_pct: number
  /** % with outcome='building'. */
  building_rate_pct: number
  /** Most-frequent error_class over the window. */
  top_error_class:   ErrorClass | null
  /** Counts per error class. */
  errors_by_class:   Partial<Record<ErrorClass, number>>
  /** Latest event for this engine. */
  latest:           EngineEvent | null
}


// ─── Ring buffer ──────────────────────────────────────────────────

const RING_CAPACITY = 500
const RING: EngineEvent[] = []

/** Record a single engine outcome. Drops the oldest event when full. */
export function recordEngineEvent(e: EngineEvent): void {
  RING.push(e)
  if (RING.length > RING_CAPACITY) RING.shift()
}

/** Snapshot of the full ring (newest last). Server-only consumer. */
export function snapshotEvents(): EngineEvent[] {
  return [...RING]
}


// ─── Error classification (sanitized) ────────────────────────────

/** Match raw engine notes to one of our sanitized error classes. The
 *  output never reveals provider names, HTTP bodies, or stack traces —
 *  the admin page is shareable / screenshotable. Returns null for
 *  notes that don't look like errors at all. */
export function classifyError(rawNote: string): ErrorClass | null {
  if (!rawNote) return null
  const t = rawNote.toLowerCase()
  if (/rate.?limit/.test(t))                          return 'rate_limit'
  if (/insufficient\s+credits?|credits?\s+exhausted/.test(t)) return 'credits_exhausted'
  if (/unauthor|forbidden|\bapi[\s-]?key\b/.test(t))  return 'auth_failure'
  if (/timeout|timed\s+out/.test(t))                  return 'timeout'
  if (/econnrefused|connection\s+refused/.test(t))    return 'connection_refused'
  if (/\b5\d\d\b|http\s*5\d\d/.test(t))               return 'http_5xx'
  if (/\b4\d\d\b|http\s*4\d\d/.test(t))               return 'http_4xx'
  if (/not\s+configured|api[\s-]?key.*(missing|not\s+set)/.test(t))
                                                       return 'config_missing'
  if (/insufficient\s+(symbols?|data|bars)|no\s+(data|bars|history)/.test(t))
                                                       return 'no_data'
  if (/partial|excluded\s+from\s+vote|unavailable|fetch\s+failed/.test(t))
                                                       return 'partial_data'
  if (/awaiting|stub|not\s+yet\s+wired/.test(t))      return 'partial_data'
  // Notes that look like institutional reasoning aren't errors at all.
  // Avoid forcing a class — the caller passes null through.
  return null
}


// ─── Aggregation ─────────────────────────────────────────────────

/** Aggregate the buffer into per-engine health rows. Window is in
 *  events (not time) so a sleepy engine doesn't disappear from the
 *  view because nothing has happened for it. */
export function aggregateHealth(opts: { perEngineLimit?: number } = {}): EngineHealthRow[] {
  const limit = opts.perEngineLimit ?? 50
  const byEngine = new Map<string, EngineEvent[]>()
  // Walk newest-first to bound each engine's slice at `limit`.
  for (let i = RING.length - 1; i >= 0; i--) {
    const e = RING[i]!
    const arr = byEngine.get(e.engine) ?? []
    if (arr.length >= limit) continue
    arr.push(e)
    byEngine.set(e.engine, arr)
  }

  const rows: EngineHealthRow[] = []
  for (const [engine, events] of byEngine) {
    const total = events.length
    const live  = events.filter((e) => e.outcome === 'live').length
    const stale = events.filter((e) => e.outcome === 'stale').length
    const heuristic = events.filter((e) => e.outcome === 'heuristic').length
    const building = events.filter((e) => e.outcome === 'building').length
    const errorsByClass: Partial<Record<ErrorClass, number>> = {}
    for (const e of events) {
      if (e.error_class) {
        errorsByClass[e.error_class] = (errorsByClass[e.error_class] ?? 0) + 1
      }
    }
    let topErrorClass: ErrorClass | null = null
    let topCount = 0
    for (const [cls, count] of Object.entries(errorsByClass) as Array<[ErrorClass, number]>) {
      if (count > topCount) { topCount = count; topErrorClass = cls }
    }
    rows.push({
      engine,
      events_seen:         total,
      live_rate_pct:       Math.round((live      / total) * 100),
      stale_rate_pct:      Math.round((stale     / total) * 100),
      heuristic_rate_pct:  Math.round((heuristic / total) * 100),
      building_rate_pct:   Math.round((building  / total) * 100),
      top_error_class:     topErrorClass,
      errors_by_class:     errorsByClass,
      latest:              events[0] ?? null,  // events is newest-first per the slice above
    })
  }

  // Stable display order — match the grid's canonical engine sequence.
  const ORDER = ['regime', 'momentum', 'breadth', 'smartMoney', 'whaleFlow',
                 'dominance', 'correlation', 'volatility', 'execution']
  rows.sort((a, b) => {
    const ai = ORDER.indexOf(a.engine), bi = ORDER.indexOf(b.engine)
    if (ai === -1 && bi === -1) return a.engine.localeCompare(b.engine)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return rows
}


/** Test-only helper. Lets the test suite (when we add one) clear the
 *  buffer between cases. Server-only consumer. */
export function _resetForTests(): void {
  RING.length = 0
}
