/**
 * Broker equity anchor (Phase 10B / B5 surface wiring).
 *
 * ONE place that derives the account-equity anchor + its age from broker
 * connection rows, so every drawdown surface (overview / risk / analytics)
 * uses an identical anchor and an identical staleness verdict. Without this,
 * wiring B5 per-surface would re-introduce the cross-dashboard divergence that
 * Phase 10A removed.
 *
 * Pure + self-contained → node-testable.
 */

export interface BrokerEquityRow {
  equity_usd?:        number | null
  equity_updated_at?: string | null
}

export interface EquityAnchor {
  equity:      number | undefined   // undefined when no connected equity
  ageSeconds:  number | null        // null when no timestamp
}

/** Highest connected equity, with the age of THAT row's equity reading. */
export function brokerEquityAnchor(rows: BrokerEquityRow[], now: number = Date.now()): EquityAnchor {
  let best: BrokerEquityRow | null = null
  for (const r of rows ?? []) {
    if (typeof r.equity_usd === 'number' && Number.isFinite(r.equity_usd) && r.equity_usd > 0) {
      if (!best || (r.equity_usd as number) > (best.equity_usd as number)) best = r
    }
  }
  if (!best) return { equity: undefined, ageSeconds: null }
  const ts = best.equity_updated_at ? Date.parse(best.equity_updated_at) : NaN
  const ageSeconds = Number.isFinite(ts) ? Math.max(0, Math.round((now - ts) / 1000)) : null
  return { equity: best.equity_usd as number, ageSeconds }
}

/** "3h 42m", "12m", "45s" — for the stale-equity caption. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'unknown age'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
