/**
 * Server-side funnel event tracker.
 *
 * Mirrors lib/tracking/client.ts but inserts directly into
 * growth_attribution_events via the service-role client. Used by
 * conversion paths the user can't (or shouldn't) instrument
 * client-side:
 *   - signup completion (auth callback)
 *   - broker connection persist
 *   - payment approval
 *   - first journal entry / first strategy save
 *
 * Fire-and-forget — failures are swallowed so an analytics write
 * cannot fail the primary conversion. Caller does not await.
 */
import { createClient as serviceClient } from '@supabase/supabase-js'

export type CanonicalEvent =
  | 'pageview' | 'signup'
  | 'broker_connected' | 'trade_synced'
  | 'journal_created' | 'strategy_created'
  | 'premium_upgrade' | 'churn'

export interface ServerTrackOptions {
  event:       CanonicalEvent | string
  userId?:     string | null
  visitorId?:  string | null
  source_kind?: string
  source_id?:  string
  path?:       string
  payload?:    Record<string, unknown>
  /** Override the event time — used for backfills. Default: now(). */
  occurredAt?: Date
}

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Insert one funnel event. Best-effort; returns void. NEVER throws.
 */
export async function trackServer(opts: ServerTrackOptions): Promise<void> {
  try {
    await svc().from('growth_attribution_events').insert({
      event:        opts.event,
      visitor_id:   opts.visitorId ?? null,
      user_id:      opts.userId ?? null,
      source_kind:  opts.source_kind ?? null,
      source_id:    opts.source_id ?? null,
      path:         opts.path ?? null,
      payload:      opts.payload ?? {},
      occurred_at:  (opts.occurredAt ?? new Date()).toISOString(),
    })
  } catch {
    /* swallow */
  }
}

/**
 * Same as trackServer() but doesn't block the caller. Use this from
 * conversion-critical paths — the analytics write happens in the
 * background.
 */
export function trackServerAsync(opts: ServerTrackOptions): void {
  trackServer(opts).catch(() => {})
}
