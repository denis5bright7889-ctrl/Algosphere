/**
 * Market language — the presentation translation layer.
 *
 * The quant engines (DER, entropy, autocorrelation, ATR, regime classifier,
 * confidence) keep running unchanged. This module ONLY translates their raw
 * outputs into readable, institutional market intelligence. Raw values stay
 * available for the opt-in "Advanced Quant Metrics" view; nothing here
 * weakens or alters the backend.
 *
 * Hard rule: never surface 'Unknown' / NaN / null. Unclear inputs map to a
 * calm institutional label (Mixed Conditions / Awaiting Confirmation / …).
 */

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0
const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_')

// ── Market state ────────────────────────────────────────────────────────
export type MarketState =
  | 'Trending Up' | 'Trending Down' | 'Trending' | 'Ranging' | 'Volatile'
  | 'Breakout Setup' | 'Reversal Risk' | 'Accumulation' | 'Distribution'
  | 'Mixed Conditions'

/** Engine regime → institutional market state. Never 'Unknown'. */
export function marketState(regime: string | null | undefined): MarketState {
  switch (norm(regime)) {
    case 'trending':        return 'Trending'
    case 'trending_up':     return 'Trending Up'
    case 'trending_down':   return 'Trending Down'
    case 'mean_reversion':
    case 'ranging':         return 'Ranging'
    case 'high_volatility':
    case 'volatile':        return 'Volatile'
    case 'breakout':        return 'Breakout Setup'
    case 'reversal':        return 'Reversal Risk'
    case 'accumulation':    return 'Accumulation'
    case 'distribution':    return 'Distribution'
    case 'exhaustion':      return 'Mixed Conditions'
    default:                return 'Mixed Conditions'  // unknown / null / '' → calm fallback
  }
}

// ── Trend strength + confidence (from DER, the directional-energy ratio) ──
export type Strength = 'Weak' | 'Moderate' | 'Strong'
export function trendStrength(der: number | null | undefined): Strength {
  const d = num(der)
  if (d >= 0.7) return 'Strong'
  if (d >= 0.4) return 'Moderate'
  return 'Weak'
}
export function confidencePct(der: number | null | undefined): number {
  return Math.max(0, Math.min(100, Math.round(num(der) * 100)))
}

// ── Volatility (from ATR, fraction e.g. 0.006 = 0.6%) ─────────────────────
export type VolLevel = 'Stable' | 'Normal' | 'Elevated' | 'High'
export function volatilityLevel(atrPct: number | null | undefined): VolLevel {
  const a = num(atrPct) * 100
  if (a >= 1.0) return 'High'
  if (a >= 0.6) return 'Elevated'
  if (a >= 0.3) return 'Normal'
  return 'Stable'
}

// ── Momentum (from autocorrelation: + persistent/trending, − mean-revert) ─
export type Bias = 'Bullish' | 'Bearish' | 'Neutral'
export type Consistency = 'Strong' | 'Moderate' | 'Weak'
/** Momentum consistency — the brief's "AutoCorr → Momentum Consistency". */
export function momentumConsistency(autocorr: number | null | undefined): Consistency {
  const c = num(autocorr)
  if (c >= 0.15) return 'Strong'
  if (c >= 0.05) return 'Moderate'
  return 'Weak'
}
/** Coarse momentum bias label for at-a-glance reads. */
export function momentumBias(autocorr: number | null | undefined): 'Trending' | 'Choppy' | 'Neutral' {
  const c = num(autocorr)
  if (c >= 0.1)  return 'Trending'
  if (c <= -0.1) return 'Choppy'
  return 'Neutral'
}

// ── Market structure (derived from the classified regime; entropy's raw
//    scale is engine-specific, so we read structure off the regime, not the
//    raw entropy sign — entropy stays visible in Advanced view). ───────────
export type Structure = 'Orderly' | 'Choppy' | 'Unclear Structure'
export function marketStructure(regime: string | null | undefined): Structure {
  switch (norm(regime)) {
    case 'trending':
    case 'trending_up':
    case 'trending_down':
    case 'mean_reversion':
    case 'ranging':         return 'Orderly'
    case 'high_volatility':
    case 'volatile':        return 'Choppy'
    default:                return 'Unclear Structure'
  }
}

// ── Behavioral / sizing (coach) ───────────────────────────────────────────
export type SizingLabel = 'Consistent' | 'Steady' | 'Erratic' | '—'
/** Coefficient of variation of position sizing → readable consistency.
 * Lower CV = more uniform sizing. (Coach drift threshold ≈ 0.6.) */
export function sizingConsistency(cv: number | null | undefined): SizingLabel {
  if (typeof cv !== 'number' || !Number.isFinite(cv)) return '—'
  if (cv <= 0.3) return 'Consistent'
  if (cv <= 0.6) return 'Steady'
  return 'Erratic'
}

// ── Session ───────────────────────────────────────────────────────────────
export function sessionLabel(session: string | null | undefined): string {
  const map: Record<string, string> = {
    london: 'London', new_york: 'New York', london_ny: 'London / New York',
    asian: 'Asian', off_hours: 'Off-hours',
  }
  const s = norm(session)
  return map[s] ?? (session ? session.replace(/_/g, ' ') : 'Awaiting')
}

// ── Tone helper for badges (state → tailwind classes) ─────────────────────
export function stateTone(state: MarketState): string {
  switch (state) {
    case 'Trending Up':   case 'Trending':    case 'Accumulation':
      return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
    case 'Trending Down': case 'Reversal Risk': case 'Distribution':
      return 'text-rose-400 bg-rose-500/15 border-rose-500/30'
    case 'Volatile':
      return 'text-amber-400 bg-amber-500/15 border-amber-500/30'
    case 'Breakout Setup':
      return 'text-blue-400 bg-blue-500/15 border-blue-500/30'
    case 'Ranging':
      return 'text-sky-400 bg-sky-500/15 border-sky-500/30'
    default: // Mixed Conditions
      return 'text-muted-foreground bg-muted/20 border-border'
  }
}
