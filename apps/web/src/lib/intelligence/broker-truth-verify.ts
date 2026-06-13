/**
 * Broker Truth Verification (Phase 10, Part 2).
 *
 * The broker is the source of truth; the database is derived truth. This
 * module reconciles the two and SURFACES every discrepancy — it never silently
 * continues. Pure + self-contained (no imports) → node-testable; an admin
 * route / reconciler worker feeds it live broker reads vs. stored state.
 *
 * Verification rules (from the Phase 10 spec):
 *   trade count   — broker vs DB
 *   balance       — broker vs stored
 *   equity        — broker vs stored
 *   open positions— broker vs stored
 *   staleness     — how old is the stored equity vs now
 */

export type DiscrepancySeverity = 'critical' | 'high' | 'medium' | 'low'

export interface BrokerState {
  trade_count?:    number | null
  balance?:        number | null
  equity?:         number | null
  open_positions?: number | null
}

export interface StoredState extends BrokerState {
  /** Age of the stored equity reading, in seconds (now − equity_updated_at). */
  equity_age_s?:   number | null
}

export interface VerifyTolerances {
  /** Absolute currency tolerance for balance/equity (broker rounding/spread). */
  money_abs?:      number   // default 0.5
  /** Max acceptable staleness of stored equity, seconds. */
  max_equity_age_s?: number // default 900 (15m)
}

export interface Discrepancy {
  field:    'trade_count' | 'balance' | 'equity' | 'open_positions' | 'equity_staleness'
  severity: DiscrepancySeverity
  broker:   number | null
  stored:   number | null
  delta:    number | null
  message:  string
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Compare broker reality to stored state. Returns EVERY discrepancy found.
 * A field that cannot be compared (either side missing) is itself flagged —
 * "unknown" is a discrepancy, never an implicit match.
 */
export function verifyBrokerTruth(
  broker: BrokerState, stored: StoredState, tol: VerifyTolerances = {},
): Discrepancy[] {
  const moneyAbs = tol.money_abs ?? 0.5
  const maxAge   = tol.max_equity_age_s ?? 900
  const out: Discrepancy[] = []

  // ── Trade count (exact) — any mismatch means missing/duplicated trades.
  if (num(broker.trade_count) && num(stored.trade_count)) {
    const d = stored.trade_count - broker.trade_count
    if (d !== 0) {
      out.push({
        field: 'trade_count', broker: broker.trade_count, stored: stored.trade_count, delta: d,
        severity: 'critical',
        message: d > 0
          ? `DB has ${d} MORE trades than the broker — possible duplicate ingestion.`
          : `DB is MISSING ${-d} trades present at the broker.`,
      })
    }
  } else if (broker.trade_count != null || stored.trade_count != null) {
    out.push({ field: 'trade_count', broker: broker.trade_count ?? null, stored: stored.trade_count ?? null,
      delta: null, severity: 'high', message: 'Trade count not comparable (one side missing) — cannot confirm integrity.' })
  }

  // ── Balance / equity (tolerance).
  for (const field of ['balance', 'equity'] as const) {
    const b = broker[field], s = stored[field]
    if (num(b) && num(s)) {
      const d = Math.round((s - b) * 100) / 100
      if (Math.abs(d) > moneyAbs) {
        out.push({ field, broker: b, stored: s, delta: d, severity: 'high',
          message: `Stored ${field} ${s} diverges from broker ${b} by ${d} (>${moneyAbs}).` })
      }
    } else if (b != null || s != null) {
      out.push({ field, broker: b ?? null, stored: s ?? null, delta: null, severity: 'medium',
        message: `${field} not comparable (one side missing).` })
    }
  }

  // ── Open positions (exact).
  if (num(broker.open_positions) && num(stored.open_positions)) {
    const d = stored.open_positions - broker.open_positions
    if (d !== 0) {
      out.push({ field: 'open_positions', broker: broker.open_positions, stored: stored.open_positions, delta: d,
        severity: 'high',
        message: d > 0
          ? `DB shows ${d} position(s) still open that the broker has closed — stale positions.`
          : `Broker has ${-d} open position(s) the DB doesn't track.` })
    }
  } else if (broker.open_positions != null || stored.open_positions != null) {
    out.push({ field: 'open_positions', broker: broker.open_positions ?? null, stored: stored.open_positions ?? null,
      delta: null, severity: 'medium', message: 'Open-position count not comparable (one side missing).' })
  }

  // ── Staleness — stored equity older than the freshness budget.
  if (num(stored.equity_age_s) && stored.equity_age_s > maxAge) {
    out.push({ field: 'equity_staleness', broker: null, stored: Math.round(stored.equity_age_s), delta: null,
      severity: stored.equity_age_s > maxAge * 4 ? 'high' : 'medium',
      message: `Stored equity is ${Math.round(stored.equity_age_s)}s old (>${maxAge}s) — drawdown/risk may use stale equity.` })
  }

  return out
}

/** True only when broker and DB fully reconcile (no discrepancies). */
export function isReconciled(ds: Discrepancy[]): boolean {
  return ds.length === 0
}

export function worstDiscrepancy(ds: Discrepancy[]): DiscrepancySeverity | null {
  for (const s of ['critical', 'high', 'medium', 'low'] as const) {
    if (ds.some((d) => d.severity === s)) return s
  }
  return null
}
