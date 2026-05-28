/**
 * Adaptive Intelligence — Phase A: decision logger.
 *
 * Records the opinions the Intelligence engines ship into the
 * `intel_decisions` table. This is the substrate the Meta-Intelligence
 * + Strategy-Evolution phases will later learn from
 * (docs/architecture/adaptive-intelligence.md). Phase A only RECORDS —
 * it makes no claims and changes no engine behaviour.
 *
 * Design constraints:
 *   - best-effort: a logging failure must NEVER break a composer / page
 *   - bounded volume: dedup by (surface, symbol, fingerprint, 15-min
 *     bucket) via an ON CONFLICT DO NOTHING upsert, so an unchanged read
 *     inside a bucket is a no-op even though composers run per render
 *   - server-only: uses the service-role client (no user session)
 */
import 'server-only'
import crypto from 'crypto'
import { createClient as serviceClient } from '@supabase/supabase-js'

/** 15-minute dedup bucket as an ISO timestamp. */
function bucket15(): string {
  const ms = 15 * 60 * 1000
  return new Date(Math.floor(Date.now() / ms) * ms).toISOString()
}

/** Compact, stable fingerprint of the salient decision state. */
export function fingerprint(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|')
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
}

let warned = false

/**
 * Log one Intelligence decision. Fire-and-await but fully swallowed —
 * returns void and never throws. `symbol` omitted/empty for universe-level
 * surfaces (Stress, Smart Money summary).
 */
export async function logDecision(opts: {
  surface:     string
  symbol?:     string
  fingerprint: string
  payload:     unknown
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    if (!warned) { warned = true; console.warn('[intel-memory] Supabase service role not configured — decision logging disabled') }
    return
  }
  try {
    const svc = serviceClient(url, key)
    await svc.from('intel_decisions').upsert(
      {
        surface:     opts.surface,
        symbol:      opts.symbol ?? '',
        fingerprint: opts.fingerprint,
        payload:     opts.payload as Record<string, unknown>,
        bucket:      bucket15(),
      },
      { onConflict: 'surface,symbol,fingerprint,bucket', ignoreDuplicates: true },
    )
  } catch {
    // Best-effort only — never surface a logging error to the caller.
  }
}
