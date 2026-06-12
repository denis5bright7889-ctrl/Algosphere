/**
 * Signal Quality analyzer (V3 Upgrade 5).
 *
 * Pure function over REAL closed-signal outcomes + per-symbol decision
 * telemetry. Ranks symbols, regimes and confidence bands by win rate and
 * acceptance rate. Honest about gaps: true expectancy / PnL contribution is
 * marked unavailable until real fills populate pips_gained / pnl — we never
 * fabricate it.
 */

import type { EdgeConfidence } from './edge-confidence'

// Mirror of edge-confidence.edgeConfidence (inlined so this module stays
// unit-testable under node's native ESM; tiers MUST match edge-confidence.ts).
function symbolConfidence(closed: number): EdgeConfidence {
  if (!Number.isFinite(closed) || closed < 10) return 'insufficient'
  if (closed < 20) return 'low'
  if (closed < 50) return 'medium'
  return 'high'
}

export interface QSignal {
  pair:             string
  result:           'win' | 'loss' | 'breakeven' | null
  regime:           string | null
  confidence_score: number | null
}
export interface QDecision { symbol: string; generated: number; rejected: number; skipped: number }

export interface SymbolQuality {
  symbol:          string
  accepted:        number   // signals that published
  wins:            number
  losses:          number
  closed:          number
  win_rate:        number | null   // null when no closed outcomes yet
  acceptance_rate: number | null   // generated / (generated+rejected+skipped)
  avg_confidence:  number | null
  confidence:      EdgeConfidence  // evidence tier from closed-trade sample
}
export interface GroupQuality { key: string; signals: number; wins: number; losses: number; win_rate: number | null }

export interface SignalQualityReport {
  generated_at: string
  overall: { signals: number; closed: number; wins: number; losses: number; win_rate: number | null }
  pnl_available: boolean
  per_symbol:     SymbolQuality[]
  per_regime:     GroupQuality[]
  per_confidence: GroupQuality[]
  best_symbols:   SymbolQuality[]
  worst_symbols:  SymbolQuality[]
}


export function analyzeSignalQuality(input: {
  signals: QSignal[]
  decisions: QDecision[]
  now?: number
}): SignalQualityReport {
  const { signals, decisions } = input
  const now = input.now ?? Date.now()

  const decBySym = new Map(decisions.map((d) => [d.symbol.toUpperCase(), d]))

  // Per-symbol from signals (outcomes) + decisions (acceptance).
  type Acc = { accepted: number; wins: number; losses: number; closed: number; confSum: number; confN: number }
  const bySym = new Map<string, Acc>()
  const ensure = (s: string) => {
    let a = bySym.get(s); if (!a) { a = { accepted: 0, wins: 0, losses: 0, closed: 0, confSum: 0, confN: 0 }; bySym.set(s, a) }
    return a
  }
  for (const s of signals) {
    const a = ensure((s.pair ?? '').toUpperCase())
    a.accepted++
    if (s.confidence_score != null) { a.confSum += s.confidence_score; a.confN++ }
    if (s.result === 'win')  { a.wins++; a.closed++ }
    else if (s.result === 'loss') { a.losses++; a.closed++ }
    else if (s.result === 'breakeven') { a.closed++ }
  }

  const allSyms = new Set<string>([...bySym.keys(), ...decBySym.keys()])
  const per_symbol: SymbolQuality[] = [...allSyms].map((sym) => {
    const a = bySym.get(sym)
    const d = decBySym.get(sym)
    const evals = d ? d.generated + d.rejected + d.skipped : 0
    return {
      symbol: sym,
      accepted: a?.accepted ?? 0,
      wins: a?.wins ?? 0,
      losses: a?.losses ?? 0,
      closed: a?.closed ?? 0,
      win_rate: a && (a.wins + a.losses) > 0 ? round2(a.wins / (a.wins + a.losses)) : null,
      acceptance_rate: evals > 0 ? round2((d!.generated) / evals) : null,
      avg_confidence: a && a.confN > 0 ? Math.round(a.confSum / a.confN) : null,
      confidence: symbolConfidence(a?.closed ?? 0),
    }
  }).sort((x, y) => (y.win_rate ?? -1) - (x.win_rate ?? -1) || y.accepted - x.accepted)

  const per_regime = groupWinRate(signals, (s) => s.regime ?? 'unknown')
  const per_confidence = groupWinRate(signals, (s) => confBand(s.confidence_score))

  // Evidence-first (Phase 6): only symbols past the edge threshold may be
  // ranked best/worst — a 3-trade symbol is no longer called good/bad.
  const ranked = per_symbol.filter((s) => s.confidence !== 'insufficient' && s.win_rate != null)

  const wins = signals.filter((s) => s.result === 'win').length
  const losses = signals.filter((s) => s.result === 'loss').length
  const closed = signals.filter((s) => s.result != null).length

  return {
    generated_at: new Date(now).toISOString(),
    overall: { signals: signals.length, closed, wins, losses, win_rate: (wins + losses) > 0 ? round2(wins / (wins + losses)) : null },
    pnl_available: false,   // pips_gained / pnl not populated until real fills exist
    per_symbol,
    per_regime,
    per_confidence,
    best_symbols:  ranked.slice(0, 5),
    worst_symbols: [...ranked].reverse().slice(0, 5),
  }
}

function groupWinRate(signals: QSignal[], keyFn: (s: QSignal) => string): GroupQuality[] {
  const m = new Map<string, { signals: number; wins: number; losses: number }>()
  for (const s of signals) {
    const k = keyFn(s)
    let g = m.get(k); if (!g) { g = { signals: 0, wins: 0, losses: 0 }; m.set(k, g) }
    g.signals++
    if (s.result === 'win') g.wins++
    else if (s.result === 'loss') g.losses++
  }
  return [...m.entries()].map(([key, g]) => ({
    key, signals: g.signals, wins: g.wins, losses: g.losses,
    win_rate: (g.wins + g.losses) > 0 ? round2(g.wins / (g.wins + g.losses)) : null,
  })).sort((a, b) => (b.win_rate ?? -1) - (a.win_rate ?? -1))
}

function confBand(c: number | null): string {
  if (c == null) return 'unknown'
  if (c >= 85) return '85-100'
  if (c >= 75) return '75-84'
  if (c >= 65) return '65-74'
  if (c >= 55) return '55-64'
  return '<55'
}

function round2(x: number): number { return Math.round(x * 100) / 100 }
