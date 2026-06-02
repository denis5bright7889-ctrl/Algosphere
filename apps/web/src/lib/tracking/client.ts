/**
 * Client-side tracking helper. Pings /api/track/event via
 * navigator.sendBeacon (queue-and-forget — survives page unload),
 * falling back to fetch keepalive.
 *
 * Safe to call from any client component. SSR paths must NOT call
 * this — guards on `typeof window`.
 */

export type CanonicalEvent =
  | 'pageview' | 'signup'
  | 'broker_connected' | 'trade_synced'
  | 'journal_created' | 'strategy_created'
  | 'premium_upgrade' | 'churn'

export interface TrackOptions {
  event:        CanonicalEvent | string
  payload?:     Record<string, unknown>
  source_kind?: 'organic' | 'direct' | 'referral' | 'email' | 'social' | 'community' | 'paid'
  source_id?:   string
}

function readUtm(): Partial<Record<'utm_source'|'utm_medium'|'utm_campaign'|'utm_content', string>> {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const out: Record<string, string> = {}
  for (const k of ['utm_source','utm_medium','utm_campaign','utm_content'] as const) {
    const v = sp.get(k)
    if (v) out[k] = v
  }
  return out
}

export function track(opts: TrackOptions): void {
  if (typeof window === 'undefined') return

  const body = JSON.stringify({
    event:    opts.event,
    path:     window.location.pathname + window.location.search,
    referrer: document.referrer || undefined,
    source_kind: opts.source_kind,
    source_id:   opts.source_id,
    ...readUtm(),
    payload:  opts.payload,
  })

  const url = '/api/track/event'

  try {
    // sendBeacon is the best path — survives navigation. Some browsers
    // reject application/json beacons, so we fall back to fetch keepalive.
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(url, blob)) return
    }
    fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Never throw from a tracker.
  }
}
