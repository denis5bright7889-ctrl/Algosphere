/**
 * Phase 11 — content quality guards.
 *
 * Three guards that catch failure modes the rest of the engine
 * doesn't already handle:
 *
 *   1. wasRecentlyPublished(kind, fingerprint, window_hours)
 *      Looks at growth_content_items and refuses to fire again if a
 *      content_item with the same kind + fingerprint was published
 *      within the window. Prevents duplicate-content for aggregates
 *      that are idempotent on the same data (e.g. a Monday cron tick
 *      that runs twice via retry).
 *
 *   2. isSourceFresh(table, freshness_hours)
 *      Verifies the source table has new rows within `freshness_hours`.
 *      Caller passes the table name + the timestamp column to inspect.
 *      Returns false when the source is stale — aggregators should
 *      then skip rather than publish a snapshot of nothing-new-since.
 *
 *   3. firmHash(input)
 *      Deterministic content fingerprint for guard #1. Stable across
 *      cold starts, doesn't require crypto API.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Returns true if a content_item of the given kind with the given
 * fingerprint was created in the past `windowHours`. Aggregators
 * use this BEFORE firing the ingestEvent — if true, skip the fire.
 */
export async function wasRecentlyPublished(
  kind:        string,
  fingerprint: string,
  windowHours: number = 20,
): Promise<boolean> {
  const db = svc()
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString()
  // The automation engine nests the event payload at
  // provenance.payload, so the fingerprint lives at
  // provenance->payload->fingerprint (not the top level).
  const { count } = await db
    .from('growth_content_items')
    .select('id', { count: 'exact', head: true })
    .eq('kind', kind)
    .gte('created_at', since)
    .filter('provenance->payload->>fingerprint', 'eq', fingerprint)
  return (count ?? 0) > 0
}

/**
 * True if the given table has any row whose `timestampCol` is within
 * the freshness window. False = source is stale; aggregator should
 * skip rather than publish snapshot of nothing-new-since.
 *
 * Defaults are conservative (48h) — only mark stale on genuinely
 * dead pipelines. The caller is welcome to pass a tighter window
 * for tables where staleness is expected to be short (e.g. signals,
 * which should be hourly).
 */
export async function isSourceFresh(
  table:          string,
  timestampCol:   string = 'created_at',
  freshnessHours: number = 48,
): Promise<boolean> {
  const db = svc()
  const since = new Date(Date.now() - freshnessHours * 3_600_000).toISOString()
  const { count, error } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(timestampCol, since)
  if (error) {
    // Tables that don't exist OR the caller passed a bad column
    // shouldn't crash the guard — treat as "fresh enough" so the
    // aggregator decides for itself.
    return true
  }
  return (count ?? 0) > 0
}

/**
 * Stable, deterministic hash for content fingerprints. Uses FNV-1a 32-bit
 * which is dependency-free and stable across runtimes. Output is a
 * hex string suitable for storing in provenance.fingerprint.
 */
export function firmHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8)
}

/**
 * Build a fingerprint for a weekly aggregate. Encodes the kind +
 * window + sample size + any salient metric so a re-run on the same
 * underlying data produces the same fingerprint, but a re-run after
 * even one new row of source data does not.
 */
export function aggregateFingerprint(
  kind:        string,
  windowDays:  number,
  sampleSize:  number,
  salient?:    Record<string, unknown>,
): string {
  const salt = salient ? JSON.stringify(Object.entries(salient).sort()) : ''
  return firmHash(`${kind}|${windowDays}|${sampleSize}|${salt}`)
}
