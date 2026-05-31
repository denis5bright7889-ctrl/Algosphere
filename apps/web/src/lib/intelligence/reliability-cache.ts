/**
 * Market Intelligence — in-memory cache (server-only).
 *
 * When an engine's current call fails, we serve the LAST successful
 * module from this cache with `userStatus: 'stale'` instead of letting
 * the user see "Unavailable" / "Awaiting" / a raw provider error. TTL
 * gating happens at the call site (composer reads `ttlFor(engine)`).
 *
 * Redis is the upgrade path documented in the V2 notes — process-
 * memory keeps the contract simple for now and survives a single web
 * process; an autoscaled deployment would need a shared store.
 *
 * Pure helpers (sanitization, source quality, freshness, status
 * derivation) live in `reliability.ts` so they remain unit-testable
 * without the server-only marker.
 */
import 'server-only'
import type { IntelligenceModule } from './grid-types'


interface CachedModule {
  module:   IntelligenceModule
  storedAt: number
}

const CACHE = new Map<string, CachedModule>()


/** Store a successfully-built module so the NEXT failed read can fall
 *  back to it instead of leaking 'unavailable' to the UI. */
export function rememberModule(m: IntelligenceModule): void {
  CACHE.set(m.key, { module: m, storedAt: Date.now() })
}

/** Recall the last successfully-built module for an engine, if any. */
export function recallModule(
  engine: string,
): { module: IntelligenceModule; ageMs: number } | null {
  const c = CACHE.get(engine)
  if (!c) return null
  return { module: c.module, ageMs: Date.now() - c.storedAt }
}
