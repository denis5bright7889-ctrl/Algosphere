/**
 * Market-timing intelligence (Refocus R4b).
 *
 * Combines the engine's live `regime_snapshots` (latest classification
 * per symbol) with the user's per-pair / per-session journal performance
 * to surface "trade now" / "wait" / "skip today" recommendations.
 *
 * Pure functions. The dashboard fetches the two inputs and hands them
 * here. No I/O, no LLM, deterministic.
 *
 * Verdict ladder:
 *   - 'avoid'     — engine regime suppresses trading (NEWS_SHOCK,
 *                   LIQUIDITY_TRAP, EXHAUSTION) OR user's session
 *                   expectancy is solidly negative.
 *   - 'caution'   — neutral regime + thin user data OR mixed signal.
 *   - 'favorable' — engine regime is constructive AND user's segment
 *                   has positive expectancy with adequate sample.
 *
 * Honest gating:
 *   - "Trade now" verdicts are issued only when BOTH the engine regime
 *     and the user's historical edge support it. Either one alone
 *     downgrades to 'caution'.
 *   - Symbols the user hasn't journaled in this window get a neutral
 *     'caution' verdict — we never recommend a fresh symbol just because
 *     the engine likes the regime.
 */
import type { SegmentRow } from './performance'


export interface RegimeSnapshot {
  symbol:      string
  regime:      string | null
  scanned_at:  string
}


export interface TimingRecommendation {
  symbol:     string
  verdict:    'favorable' | 'caution' | 'avoid'
  regime:     string | null
  user_trades:    number      // count in window
  user_win_rate:  number | null
  user_expectancy: number | null
  reasons:    string[]
  scanned_at: string | null
}


// Regimes from the signal-engine that fully suppress trading. Must
// stay in sync with apps/signal-engine/engine/regime_engine.py's
// regime_suppresses_trading() set.
const SUPPRESS_REGIMES = new Set([
  'exhaustion', 'news_shock', 'liquidity_trap',
])

// Constructive regimes — the engine treats these as actionable in
// confidence_engine.regime_quality_score (>=0.75).
const FAVORABLE_REGIMES = new Set([
  'trending', 'mean_reversion', 'ranging',
])


export interface TimingReport {
  generated_at: string
  /** Recommendations sorted favourable-first, then caution, then avoid. */
  recommendations: TimingRecommendation[]
  /** Top-line "what to do today" — synthesised summary. */
  headline: string
}


export function generateTiming(
  snapshots: RegimeSnapshot[],
  byPair: SegmentRow[],
): TimingReport {
  // Latest snapshot per symbol; assumes snapshots already arrive sorted
  // newest first but we deduplicate defensively.
  const seen = new Set<string>()
  const latest: RegimeSnapshot[] = []
  for (const s of snapshots) {
    if (seen.has(s.symbol)) continue
    seen.add(s.symbol)
    latest.push(s)
  }

  const byPairMap = new Map<string, SegmentRow>()
  for (const p of byPair) byPairMap.set(p.key.toUpperCase(), p)

  const recos: TimingRecommendation[] = latest.map((s) => {
    const user = byPairMap.get(s.symbol.toUpperCase())
    const regime = (s.regime ?? '').toLowerCase()
    const reasons: string[] = []
    let verdict: TimingRecommendation['verdict'] = 'caution'

    // Engine-side regime gate
    const engineSuppressed = SUPPRESS_REGIMES.has(regime)
    const engineFavorable  = FAVORABLE_REGIMES.has(regime)

    if (engineSuppressed) {
      verdict = 'avoid'
      reasons.push(`Engine regime "${regime}" suppresses entries.`)
    }

    // User-side edge gate
    let userEdgeFavorable: boolean | null = null
    if (user && user.reliable) {
      if (user.expectancy != null && user.expectancy > 0) {
        userEdgeFavorable = true
        reasons.push(`Your ${s.symbol} edge: ${pct(user.win_rate ?? 0)} WR, +${user.expectancy.toFixed(2)} expectancy across ${user.trades}.`)
      } else if (user.expectancy != null && user.expectancy < 0) {
        userEdgeFavorable = false
        reasons.push(`Your ${s.symbol} edge is negative: ${pct(user.win_rate ?? 0)} WR, ${user.expectancy.toFixed(2)} expectancy across ${user.trades}.`)
      }
    } else if (user) {
      reasons.push(`Only ${user.trades} ${s.symbol} trades in window — too thin to call.`)
    } else {
      reasons.push(`No ${s.symbol} trades logged in window.`)
    }

    // Combine
    if (!engineSuppressed) {
      if (engineFavorable && userEdgeFavorable === true) {
        verdict = 'favorable'
      } else if (engineFavorable && userEdgeFavorable !== false) {
        // engine likes it; user data is neutral or absent
        verdict = 'caution'
      } else if (!engineFavorable && userEdgeFavorable === false) {
        verdict = 'avoid'
      } else {
        verdict = 'caution'
      }
    }

    return {
      symbol:     s.symbol,
      verdict,
      regime:     s.regime,
      user_trades:    user?.trades ?? 0,
      user_win_rate:  user?.win_rate ?? null,
      user_expectancy: user?.expectancy ?? null,
      reasons,
      scanned_at: s.scanned_at,
    }
  })

  // Sort: favorable → caution → avoid; within bucket, prefer more user trades.
  recos.sort((a, b) => {
    const rank = (v: TimingRecommendation['verdict']) =>
      v === 'favorable' ? 0 : v === 'caution' ? 1 : 2
    if (rank(a.verdict) !== rank(b.verdict)) return rank(a.verdict) - rank(b.verdict)
    return b.user_trades - a.user_trades
  })

  const headline = buildHeadline(recos)

  return {
    generated_at: new Date().toISOString(),
    recommendations: recos,
    headline,
  }
}


function buildHeadline(recos: TimingRecommendation[]): string {
  const favourable = recos.filter((r) => r.verdict === 'favorable')
  const avoid      = recos.filter((r) => r.verdict === 'avoid')

  if (favourable.length === 0 && avoid.length === recos.length && recos.length > 0) {
    return 'No favourable setups across the universe right now — protect capital.'
  }
  if (favourable.length === 0 && recos.length === 0) {
    return 'No live regime data yet — check back after the next engine scan.'
  }
  if (favourable.length === 0) {
    return 'Engine regimes are mixed. Wait for a constructive read on a pair you have edge in.'
  }
  if (favourable.length === 1 && favourable[0]) {
    return `Best opportunity: ${favourable[0].symbol} — ${favourable[0].regime}.`
  }
  return `${favourable.length} favourable setups; lead with ${favourable.slice(0, 2).map((r) => r.symbol).join(' / ')}.`
}


function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
