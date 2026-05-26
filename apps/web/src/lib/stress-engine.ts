/**
 * Stress Engine — institutional market-environment read.
 *
 * Per the brief: tracks volatility spikes, liquidity deterioration, spread
 * widening, correlation spikes, and systemic instability — and exposes a
 * single ENVIRONMENT state (Market Stress Elevated / Defensive Environment
 * / Stable Conditions / Aggressive Conditions). The Conviction Engine layers
 * on top of this so per-symbol bias is calibrated against the broader
 * environment.
 *
 * Sources we have:
 *   Volatility       universe-wide ATR aggregation from regime_snapshots
 *   Macro pressure   AV macro snapshot — real-rate + yield direction
 *   Momentum cohesion variance of momentum scores across the universe
 *   (Liquidity / spread / true correlation matrix require data we don't
 *    have yet — those components report `available: false` honestly.)
 *
 * Honesty rules:
 *   - never exposes raw ATR / yields / momentum-score variance
 *   - components that can't be sourced report available=false; the
 *     composite is computed only over components we trust
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { composeMomentumView } from '@/lib/momentum-engine'
import { getMacroSnapshot, isAlphaVantageConfigured } from '@/lib/alphavantage'

export type StressLabel =
  | 'Market Stress Elevated'
  | 'Defensive Environment'
  | 'Stable Conditions'
  | 'Aggressive Conditions'
  | 'Unknown'

export interface StressComponent {
  name:        'Volatility' | 'Macro Pressure' | 'Momentum Cohesion' | 'Liquidity' | 'Correlation'
  /** 0..1 stress intensity from this component. */
  stress:      number
  /** True when we actually have the data for this component. */
  available:   boolean
  /** Short institutional descriptor; never a raw number. */
  signal:      string
}

export interface StressView {
  label:        StressLabel
  /** 0..100 composite stress score — high = stressed. */
  score:        number
  /** Suggested institutional posture aligned with the composite. */
  posture:      'Aggressive' | 'Active' | 'Defensive' | 'Capital Preservation'
  components:   StressComponent[]
  narrative:    string
  generated_at: string
  partial:      boolean        // true when at least one component is unavailable
}

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }
function avg(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

const STRESS_BASKET = [
  // Crypto majors + FX + metals + the equity slice we have on Polygon.
  // Universe-wide ATR aggregation needs breadth, not depth.
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT',
  'LINKUSDT','LTCUSDT','DOTUSDT',
  'XAUUSD','EURUSD','GBPUSD','USDJPY','AUDUSD',
  'AAPL','MSFT','TSLA','SPY','QQQ',
]

// ── Component builders ───────────────────────────────────────────────────

/** Volatility component — universe-wide average ATR vs a calm-baseline. */
async function volatilityComponent(): Promise<StressComponent> {
  const sb = await createClient()
  // For each symbol, take the most recent ATR. Higher mean ATR + higher
  // dispersion (some pairs vol-spiking) both indicate stress.
  const { data } = await sb
    .from('regime_snapshots')
    .select('symbol, atr_pct, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(300)
  if (!data || data.length === 0) {
    return { name: 'Volatility', stress: 0, available: false, signal: 'No regime snapshots available' }
  }
  // Keep most recent per symbol.
  const seen = new Map<string, number>()
  for (const r of data as Array<{ symbol: string; atr_pct: number }>) {
    if (!seen.has(r.symbol)) seen.set(r.symbol, Number(r.atr_pct) || 0)
  }
  const atrs = Array.from(seen.values()).filter((v) => Number.isFinite(v))
  if (atrs.length < 3) {
    return { name: 'Volatility', stress: 0, available: false, signal: 'Insufficient breadth' }
  }
  const meanAtr = avg(atrs) * 100          // mean ATR pct across universe
  // Baseline: 0.4% is calm, 1.5% is genuinely stressed (high-vol crypto + equity together).
  const stress  = clamp01((meanAtr - 0.4) / 1.1)
  const signal =
    meanAtr >= 1.2 ? 'Volatility broad and elevated across universe' :
    meanAtr >= 0.7 ? 'Elevated volatility in pockets'                :
    meanAtr >= 0.4 ? 'Volatility within normal band'                 :
                     'Volatility calm — orderly conditions'
  return { name: 'Volatility', stress, available: true, signal }
}

/** Macro pressure — rising yields + sticky inflation = stress. */
async function macroComponent(): Promise<StressComponent> {
  if (!isAlphaVantageConfigured()) {
    return { name: 'Macro Pressure', stress: 0, available: false, signal: 'Macro layer not configured' }
  }
  try {
    const snap = await getMacroSnapshot()
    const cpi = snap.indicators.find((i) => i.key === 'inflation_yoy')
    const fed = snap.indicators.find((i) => i.key === 'fed_funds_rate')
    const ten = snap.indicators.find((i) => i.key === 'treasury_10y')
    if (!cpi || !fed || !ten) {
      return { name: 'Macro Pressure', stress: 0, available: false, signal: 'Macro indicators incomplete' }
    }
    // Stress builds when: 10Y rising, fed not easing, CPI elevated/sticky.
    const yieldStress = ten.trend === 'rising' ? 0.5 : ten.trend === 'falling' ? 0.0 : 0.25
    const fedStress   = fed.trend === 'rising' ? 0.3 : fed.trend === 'falling' ? 0.0 : 0.15
    const cpiStress   = Math.max(0, Math.min(1, ((cpi.yoy_change ?? 0) - 2.0) / 4.0)) * 0.4   // CPI > 2% adds stress, > 6% maxes
    const stress = clamp01(yieldStress + fedStress + cpiStress)
    const signal =
      stress >= 0.7 ? 'Tight macro — yields and inflation both pressuring'  :
      stress >= 0.4 ? 'Mixed macro — partial pressure'                       :
      stress >= 0.2 ? 'Moderate macro — yields softening / inflation easing' :
                      'Constructive macro — easing tilt'
    return { name: 'Macro Pressure', stress, available: true, signal }
  } catch {
    return { name: 'Macro Pressure', stress: 0, available: false, signal: 'Macro snapshot unavailable' }
  }
}

/** Momentum cohesion — high variance across universe = decoupling = stress. */
async function momentumCohesionComponent(): Promise<StressComponent> {
  // Reuse momentum views for the basket so we don't burn extra DB queries.
  const views = await Promise.all(STRESS_BASKET.map((s) => composeMomentumView(s)))
  const scores = views.filter((v) => v.phase !== 'Unknown').map((v) => v.score)
  if (scores.length < 6) {
    return { name: 'Momentum Cohesion', stress: 0, available: false, signal: 'Insufficient universe coverage' }
  }
  const mean = avg(scores)
  const variance = avg(scores.map((s) => (s - mean) ** 2))
  const stdev = Math.sqrt(variance)
  // Normalise: stdev of 25 = high decoupling (one third of asset range diverging).
  const stress = clamp01(stdev / 28)
  // Also penalise if the *mean* is low (universe broadly weak/exhausted) — separate dimension.
  const meanPenalty = mean < 40 ? 0.2 : 0
  const composite = clamp01(stress + meanPenalty)
  const signal =
    composite >= 0.65 ? 'Universe decoupled — momentum scattered'  :
    composite >= 0.4  ? 'Mixed momentum — partial divergence'      :
    composite >= 0.2  ? 'Momentum mostly aligned'                   :
                        'Universe cohesive — momentum aligned'
  return { name: 'Momentum Cohesion', stress: composite, available: true, signal }
}

// ── Composite + classification ───────────────────────────────────────────

function composite(components: StressComponent[]): { score: number; partial: boolean } {
  const known = components.filter((c) => c.available)
  if (known.length === 0) return { score: 0, partial: true }
  const composite01 = avg(known.map((c) => c.stress))
  return { score: Math.round(composite01 * 100), partial: known.length < components.length }
}

function labelOf(score: number): StressLabel {
  if (score >= 70) return 'Market Stress Elevated'
  if (score >= 45) return 'Defensive Environment'
  if (score >= 20) return 'Stable Conditions'
  return 'Aggressive Conditions'
}

function postureOf(label: StressLabel): StressView['posture'] {
  switch (label) {
    case 'Market Stress Elevated':  return 'Capital Preservation'
    case 'Defensive Environment':   return 'Defensive'
    case 'Stable Conditions':       return 'Active'
    case 'Aggressive Conditions':   return 'Aggressive'
    default:                        return 'Defensive'
  }
}

function narrate(label: StressLabel, components: StressComponent[]): string {
  const top = [...components.filter((c) => c.available)].sort((a, b) => b.stress - a.stress)[0]
  const driver = top ? ` Driver: ${top.name.toLowerCase()}.` : ''
  switch (label) {
    case 'Market Stress Elevated':
      return `Market stress is elevated — defensive environment, reduce exposure.${driver}`
    case 'Defensive Environment':
      return `Defensive environment — selectivity over breadth.${driver}`
    case 'Stable Conditions':
      return `Stable conditions — orderly tape, normal risk budget.${driver}`
    case 'Aggressive Conditions':
      return `Aggressive conditions — supportive backdrop for risk-on positioning.${driver}`
    default:
      return 'Environment indeterminate — insufficient data to read stress.'
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function composeStressView(): Promise<StressView> {
  // Liquidity + true correlation matrix require data we don't yet have on
  // current plans. Report them honestly as unavailable rather than fake.
  const liquidityStub: StressComponent = {
    name:      'Liquidity',
    stress:    0,
    available: false,
    signal:    'Requires order-book / spread data (paid feed)',
  }
  const correlationStub: StressComponent = {
    name:      'Correlation',
    stress:    0,
    available: false,
    signal:    'Requires multi-asset correlation matrix (planned)',
  }

  const [vol, macro, cohesion] = await Promise.all([
    volatilityComponent(),
    macroComponent(),
    momentumCohesionComponent(),
  ])
  const components = [vol, macro, cohesion, liquidityStub, correlationStub]
  const { score, partial } = composite(components)
  const label = score === 0 && partial ? 'Unknown' : labelOf(score)
  const posture = postureOf(label)
  return {
    label,
    score,
    posture,
    components,
    narrative:    narrate(label, components),
    generated_at: new Date().toISOString(),
    partial,
  }
}
