/**
 * Symbol Coverage analyzer (master-prompt layer 6).
 *
 * Pure function over real engine telemetry — answers "which configured
 * symbols are firing, which are silently dead, and WHY." Inputs are the
 * configured universe (from the engine /status), the per-symbol decision
 * events the engine writes to system_event_log (signal_generated /
 * signal_rejected / signal_skipped / risk_block), and the last regime
 * scan per symbol (proves the data feed is alive even when no signal fires).
 *
 * No fabrication: a symbol with no telemetry is classified `never`
 * (unconfigured / missing feed), not hidden. Deterministic; no I/O.
 */

export type SymbolClass =
  | 'active'     // signal generated in the last 24h
  | 'dormant'    // last signal 24h–window; alive but quiet
  | 'filtered'   // evaluated recently but consistently rejected/skipped (see reason)
  | 'inactive'   // last activity older than the window
  | 'degraded'   // scanning (regime) but no decision logged — pipeline gap
  | 'never'      // never evaluated/scanned in the window — unconfigured or dead feed

export interface SymbolEvent {
  surface: string            // signal_generated | signal_rejected | signal_skipped | risk_block
  symbol:  string
  reason:  string | null
  at:      string            // ISO
}

export interface CoverageInput {
  universe:        string[]
  events:          SymbolEvent[]
  /** symbol → last regime scan ISO (from regime_snapshots). */
  lastScanBySymbol: Record<string, string>
  now:             number
  windowDays:      number
}

export interface SymbolCoverage {
  symbol:         string
  classification: SymbolClass
  last_signal_at: string | null
  last_eval_at:   string | null
  last_scan_at:   string | null
  generated:      number
  rejected:       number
  skipped:        number
  top_reason:     string | null
  detail:         string
}

export interface CoverageReport {
  generated_at: string
  window_days:  number
  universe_size: number
  summary:      Record<SymbolClass, number>
  symbols:      SymbolCoverage[]
}

const DAY_MS = 86_400_000

export function analyzeSymbolCoverage(input: CoverageInput): CoverageReport {
  const { universe, events, lastScanBySymbol, now, windowDays } = input
  const windowMs = windowDays * DAY_MS

  // Bucket events per symbol.
  type Bucket = {
    generated: number; rejected: number; skipped: number
    lastGen: number | null; lastEval: number | null
    reasons: Record<string, number>
  }
  const by = new Map<string, Bucket>()
  const ensure = (s: string): Bucket => {
    let b = by.get(s)
    if (!b) { b = { generated: 0, rejected: 0, skipped: 0, lastGen: null, lastEval: null, reasons: {} }; by.set(s, b) }
    return b
  }

  for (const e of events) {
    if (!e.symbol) continue
    const t = Date.parse(e.at)
    // Keep ALL provided history (caller bounds the fetch) — the classifier
    // uses the 24h / window thresholds to tell active vs dormant vs
    // inactive. Pre-filtering to the window would make "inactive" (had
    // signals, but not recently) indistinguishable from "never".
    if (Number.isNaN(t)) continue
    const b = ensure(e.symbol.toUpperCase())
    b.lastEval = Math.max(b.lastEval ?? 0, t)
    if (e.surface === 'signal_generated') {
      b.generated++
      b.lastGen = Math.max(b.lastGen ?? 0, t)
    } else {
      // rejected / skipped / risk_block all count as "evaluated, no signal"
      if (e.surface === 'signal_skipped') b.skipped++
      else b.rejected++
      if (e.reason) b.reasons[e.reason] = (b.reasons[e.reason] ?? 0) + 1
    }
  }

  // The full set to classify = configured universe ∪ any symbol seen in events.
  const all = new Set<string>(universe.map((s) => s.toUpperCase()))
  for (const s of by.keys()) all.add(s)

  const symbols: SymbolCoverage[] = []
  for (const symbol of all) {
    const b = by.get(symbol)
    const scanIso = lastScanBySymbol[symbol] ?? lastScanBySymbol[symbol.toUpperCase()] ?? null
    const scanT = scanIso ? Date.parse(scanIso) : null
    const topReason = b ? topKey(b.reasons) : null

    const classification = classify({
      now, windowMs,
      lastGen:  b?.lastGen ?? null,
      lastEval: b?.lastEval ?? null,
      scanT:    Number.isNaN(scanT as number) ? null : scanT,
      hasEvals: !!b && (b.rejected + b.skipped) > 0,
    })

    symbols.push({
      symbol,
      classification,
      last_signal_at: b?.lastGen ? new Date(b.lastGen).toISOString() : null,
      last_eval_at:   b?.lastEval ? new Date(b.lastEval).toISOString() : null,
      last_scan_at:   scanIso,
      generated: b?.generated ?? 0,
      rejected:  b?.rejected ?? 0,
      skipped:   b?.skipped ?? 0,
      top_reason: topReason,
      detail: detailFor(classification, topReason),
    })
  }

  // Order: worst-coverage first (never → degraded → inactive → filtered → dormant → active).
  const rank: Record<SymbolClass, number> = {
    never: 0, degraded: 1, inactive: 2, filtered: 3, dormant: 4, active: 5,
  }
  symbols.sort((a, b) => rank[a.classification] - rank[b.classification] || a.symbol.localeCompare(b.symbol))

  const summary: Record<SymbolClass, number> = { active: 0, dormant: 0, filtered: 0, inactive: 0, degraded: 0, never: 0 }
  for (const s of symbols) summary[s.classification]++

  return {
    generated_at: new Date(now).toISOString(),
    window_days:  windowDays,
    universe_size: universe.length,
    summary,
    symbols,
  }
}

function classify(a: {
  now: number; windowMs: number
  lastGen: number | null; lastEval: number | null; scanT: number | null; hasEvals: boolean
}): SymbolClass {
  const { now, windowMs, lastGen, lastEval, scanT, hasEvals } = a
  if (lastGen != null) {
    const age = now - lastGen
    if (age < DAY_MS)   return 'active'
    if (age < windowMs) return 'dormant'
    return 'inactive'
  }
  // No signal in window.
  if (hasEvals && lastEval != null) {
    return now - lastEval < DAY_MS ? 'filtered' : 'inactive'
  }
  // No decisions logged at all.
  if (scanT != null && now - scanT < DAY_MS) return 'degraded' // scanning but no decision → pipeline gap
  return 'never'
}

function detailFor(c: SymbolClass, reason: string | null): string {
  switch (c) {
    case 'active':   return 'Generating signals.'
    case 'dormant':  return 'Alive but no signal in the last 24h.'
    case 'filtered': return `Evaluated but consistently blocked${reason ? ` — top reason: ${reason}` : ''}.`
    case 'inactive': return 'No activity within the window — likely filtered_out or low_volatility.'
    case 'degraded': return 'Regime scanning but no signal decision logged — pipeline gap.'
    case 'never':    return 'No evaluation or scan in the window — unconfigured or missing data feed.'
  }
}

function topKey(m: Record<string, number>): string | null {
  let best: string | null = null
  let n = -1
  for (const [k, v] of Object.entries(m)) if (v > n) { n = v; best = k }
  return best
}
