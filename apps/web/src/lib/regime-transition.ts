/**
 * Regime Transition layer — institutional "what the market is becoming".
 *
 * Per the brief (Section 6): the system must answer not just what the
 * market IS, but what it's transitioning toward. Stability tells you how
 * confidently the current regime read can be relied on; transition
 * probability tells you how likely the regime is to shift in the next
 * window.
 *
 * Sourcing: reads the recent snapshot trajectory for a symbol from
 * `regime_snapshots`. Computed entirely client/server-side off existing
 * persisted features — no engine compute, no new persistent state.
 *
 * Honesty rule (same pattern as Momentum / Conviction / Stress):
 *   - stability=null with reason when too little history
 *   - transitionDirection='N/A' when stability is null or no clear
 *     successor regime is visible in the trajectory
 *   - never exposes raw DER / ATR / autocorr in the output
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { marketState, type MarketState } from '@/lib/market-language'

export type Stability   = 'Stable' | 'Drifting' | 'Unstable' | 'N/A'
export type Transition  = 'Likely' | 'Possible' | 'Unlikely' | 'N/A'

export interface RegimeTransitionView {
  symbol:                 string
  /** Current regime classification mapped to the institutional label. */
  current:                MarketState
  /** Categorical read of how consistent the regime has been across recent snapshots. */
  stability:              Stability
  /** 0..1 probability the regime is about to shift. null when insufficient history. */
  transition_probability: number | null
  /** Categorical version of the above, suitable for badges. */
  transition:             Transition
  /** Where the regime appears to be heading if a transition is in progress. */
  transitioning_to:       MarketState | null
  /** Short institutional descriptor; never a formula. */
  signal:                 string
  generated_at:           string
  /** True when the snapshot window was too thin for confident derivation. */
  partial:                boolean
}

interface RegimeRow {
  regime:           string
  der_score:        number
  autocorr_score:   number
  atr_pct:          number
  scanned_at:       string
}

/** Reads the most-recent N snapshots for one symbol (newest first). */
async function loadTrajectory(symbol: string, n = 12): Promise<RegimeRow[]> {
  const sb = await createClient()
  const { data } = await sb
    .from('regime_snapshots')
    .select('regime, der_score, autocorr_score, atr_pct, scanned_at')
    .eq('symbol', symbol)
    .order('scanned_at', { ascending: false })
    .limit(n)
  return (data ?? []) as unknown as RegimeRow[]
}

// ── Derivation ───────────────────────────────────────────────────────────

/** Counts how many of the recent snapshots agree with the current regime. */
function stabilityRead(rows: RegimeRow[]): { stability: Stability; agreement: number } {
  if (rows.length < 3) return { stability: 'N/A', agreement: 0 }
  const current = rows[0]!.regime
  const sameAsCurrent = rows.filter((r) => r.regime === current).length
  const agreement = sameAsCurrent / rows.length
  const stability: Stability =
    agreement >= 0.8 ? 'Stable' :
    agreement >= 0.55 ? 'Drifting' :
    'Unstable'
  return { stability, agreement }
}

/** Probability the regime will shift soon, derived from feature drift. */
function transitionRead(rows: RegimeRow[], stability: Stability): { probability: number | null; transition: Transition; transitioningTo: MarketState | null } {
  if (rows.length < 6 || stability === 'N/A') {
    return { probability: null, transition: 'N/A', transitioningTo: null }
  }
  // Drift = how much the most-recent features have moved vs the older half.
  const split = Math.floor(rows.length / 2)
  const recent = rows.slice(0, split)
  const older  = rows.slice(split)
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1)
  const derDelta = avg(recent.map((r) => r.der_score      || 0)) - avg(older.map((r) => r.der_score      || 0))
  const acDelta  = avg(recent.map((r) => r.autocorr_score || 0)) - avg(older.map((r) => r.autocorr_score || 0))
  const atrDelta = avg(recent.map((r) => r.atr_pct        || 0)) - avg(older.map((r) => r.atr_pct        || 0))
  // Magnitude normalisation — these are calibrated against typical observed
  // ranges so the resulting probability is in a sensible 0..1 band.
  const drift = Math.min(1,
    Math.abs(derDelta) * 1.5 +
    Math.abs(acDelta)  * 2.0 +
    Math.abs(atrDelta) * 120
  )
  // Combine drift with stability — Unstable history amplifies transition risk
  const stabilityPenalty =
    stability === 'Unstable' ? 0.3 :
    stability === 'Drifting' ? 0.15 :
    0
  const probability = Math.min(1, Math.max(0, drift + stabilityPenalty))
  const transition: Transition =
    probability >= 0.6 ? 'Likely' :
    probability >= 0.3 ? 'Possible' :
    'Unlikely'

  // What's it transitioning TO? If recent snapshots show a different
  // regime, that's the successor. Otherwise null (drift without a clear
  // successor — caution rather than fabricated direction).
  let transitioningTo: MarketState | null = null
  if (transition !== 'Unlikely') {
    const recentRegimes = new Set(recent.map((r) => r.regime))
    const olderRegimes  = new Set(older .map((r) => r.regime))
    const novel = [...recentRegimes].filter((r) => !olderRegimes.has(r))
    if (novel.length === 1) transitioningTo = marketState(novel[0])
  }
  return { probability, transition, transitioningTo }
}

function buildSignal(view: { current: MarketState; stability: Stability; transition: Transition; transitioningTo: MarketState | null }): string {
  if (view.stability === 'N/A') return 'Awaiting more scans to read stability'
  if (view.stability === 'Stable' && view.transition === 'Unlikely')   return `${view.current} regime — stable, low transition risk`
  if (view.stability === 'Stable' && view.transition === 'Possible')   return `${view.current} regime stable, but drift detected`
  if (view.stability === 'Drifting' && view.transition === 'Possible') return `${view.current} regime drifting — transition possible`
  if (view.stability === 'Drifting' && view.transition === 'Likely' && view.transitioningTo)
                                                                        return `${view.current} drifting toward ${view.transitioningTo}`
  if (view.stability === 'Unstable')                                    return `${view.current} call low-confidence — regime unstable`
  if (view.transition === 'Likely' && view.transitioningTo)             return `Transitioning toward ${view.transitioningTo}`
  if (view.transition === 'Likely')                                     return 'Transition likely — successor unclear'
  return `${view.current} regime`
}

// ── Public API ───────────────────────────────────────────────────────────

export async function composeRegimeTransition(symbol: string): Promise<RegimeTransitionView> {
  const rows = await loadTrajectory(symbol, 12)
  if (rows.length === 0) {
    return {
      symbol,
      current:                'Mixed Conditions',
      stability:              'N/A',
      transition_probability: null,
      transition:             'N/A',
      transitioning_to:       null,
      signal:                 'No recent regime scans for this symbol',
      generated_at:           new Date().toISOString(),
      partial:                true,
    }
  }
  const current = marketState(rows[0]!.regime)
  const { stability } = stabilityRead(rows)
  const { probability, transition, transitioningTo } = transitionRead(rows, stability)
  const signal = buildSignal({ current, stability, transition, transitioningTo })
  return {
    symbol,
    current,
    stability,
    transition_probability: probability,
    transition,
    transitioning_to:       transitioningTo,
    signal,
    generated_at:           new Date().toISOString(),
    partial:                rows.length < 8,
  }
}
