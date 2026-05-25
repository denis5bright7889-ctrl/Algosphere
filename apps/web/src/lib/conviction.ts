/**
 * Conviction Engine — multi-layer agreement composer.
 *
 * Composes a Bloomberg-style "all factors aligned" view from the engines
 * we already run. Per the platform philosophy: this exposes STATES, BIAS,
 * and STRENGTH — never raw formulas or thresholds. Each layer is read
 * from an existing data source so we never fabricate signal.
 *
 * Layers (and where they read from):
 *   Momentum      regime_snapshots.der_score + autocorr_score
 *   Regime        regime_snapshots.regime (institutional label via market-language)
 *   Volatility    regime_snapshots.atr_pct
 *   Smart Money   Nansen tokenScreener (crypto only; N/A elsewhere)
 *   Participation Nansen whale netflow (crypto only; N/A elsewhere)
 *   Macro         AV macro snapshot — fed-funds vs 10Y vs CPI direction
 *
 * When a layer can't be sourced (e.g. macro key absent, Nansen down),
 * it reports bias='N/A' with a one-line reason. The composite explicitly
 * excludes N/A layers from the agreement count — Conviction is computed
 * over what we ACTUALLY know, not over imagined signal.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { marketState, type MarketState } from '@/lib/market-language'
import { tokenScreener, isNansenConfigured, type NansenChain } from '@/lib/nansen'
import { getMacroSnapshot, isAlphaVantageConfigured } from '@/lib/alphavantage'

export type Bias    = 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed' | 'N/A'
export type Composite = 'Very High' | 'High' | 'Moderate' | 'Weak'

export interface ConvictionLayer {
  name:     'Momentum' | 'Regime' | 'Volatility' | 'Smart Money' | 'Participation' | 'Macro'
  bias:     Bias
  strength: number                  // 0..5 — how decisively the layer leans
  signal:   string                  // short human descriptor, never a formula
  source:   string                  // which engine/provider answered
}

export interface ConvictionView {
  symbol:           string
  asset_class:      'crypto' | 'forex' | 'metal' | 'equity' | 'index' | 'unknown'
  layers:           ConvictionLayer[]
  composite:        Composite
  composite_bias:   'Bullish' | 'Bearish' | 'Neutral'
  /** Three probabilities summing to ~1; computed from layer agreement. */
  probability: {
    continuation:   number          // dominant trend continues
    fade:           number          // mean-revert / reversal
    chop:           number          // range-bound / no edge
  }
  narrative:        string          // one-line institutional summary
  generated_at:     string          // ISO
  /** True when one or more layers were unavailable — composite is over what we know. */
  partial:          boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────

function classifyAsset(symbol: string): ConvictionView['asset_class'] {
  const s = symbol.toUpperCase()
  if (s.endsWith('USDT')) return 'crypto'
  if (s.startsWith('I:') || ['NDX','SPX','DJI','RUT','VIX','NAS100','US30','GER40','UK100','JPN225'].includes(s)) return 'index'
  if (s === 'XAUUSD' || s === 'XAGUSD') return 'metal'
  if (s.length === 6 && /^[A-Z]+$/.test(s)) return 'forex'
  if (s.length >= 1 && s.length <= 5 && /^[A-Z]+$/.test(s)) return 'equity'
  return 'unknown'
}

interface RegimeSnap {
  symbol: string; regime: string; der_score: number; autocorr_score: number; atr_pct: number; scanned_at: string
}

/** Read the most recent regime snapshot for a symbol; null if none on file. */
async function loadRegime(symbol: string): Promise<RegimeSnap | null> {
  const sb = await createClient()
  const { data } = await sb
    .from('regime_snapshots')
    .select('symbol, regime, der_score, autocorr_score, atr_pct, scanned_at')
    .eq('symbol', symbol)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return data as unknown as RegimeSnap
}

// ── Layer builders ───────────────────────────────────────────────────────

function momentumLayer(r: RegimeSnap | null): ConvictionLayer {
  if (!r) return { name: 'Momentum', bias: 'N/A', strength: 0, signal: 'No recent scan', source: 'regime-engine' }
  const der = Number(r.der_score) || 0
  const ac  = Number(r.autocorr_score) || 0
  // Strength = how energetic the move is (DER), 0..5
  const strength = Math.min(5, Math.round(der * 5))
  // Direction comes from autocorrelation sign — positive persistence ⇒ trend-with, negative ⇒ trend-fade
  let bias: Bias = 'Neutral'
  if (der >= 0.4) {
    if (ac >=  0.05) bias = 'Bullish'
    else if (ac <= -0.05) bias = 'Bearish'
    else bias = 'Mixed'
  }
  const signal =
    der >= 0.7 ? 'Strong, persistent' :
    der >= 0.4 ? 'Moderate, sustainable' :
    'Weak, indecisive'
  return { name: 'Momentum', bias, strength, signal, source: 'regime-engine' }
}

function regimeLayer(r: RegimeSnap | null): ConvictionLayer {
  if (!r) return { name: 'Regime', bias: 'N/A', strength: 0, signal: 'No recent scan', source: 'regime-engine' }
  const state: MarketState = marketState(r.regime)
  const trending  = state === 'Trending' || state === 'Trending Up' || state === 'Trending Down'
  const ranging   = state === 'Ranging' || state === 'Accumulation'
  const volatile_ = state === 'Volatile'
  const bias: Bias = trending ? (state === 'Trending Down' ? 'Bearish' : 'Bullish')
                  : ranging   ? 'Neutral'
                  : volatile_ ? 'Mixed'
                  : 'Mixed'
  const strength  = trending ? 4 : ranging ? 2 : 1
  return { name: 'Regime', bias, strength, signal: state, source: 'regime-engine' }
}

function volatilityLayer(r: RegimeSnap | null): ConvictionLayer {
  if (!r) return { name: 'Volatility', bias: 'N/A', strength: 0, signal: 'No recent scan', source: 'regime-engine' }
  const atrPct = (Number(r.atr_pct) || 0) * 100
  // Vol is not directional — surfaces as Mixed (env caveat) when elevated,
  // Neutral when normal. Strength is how unstable the environment is.
  const elevated = atrPct >= 1.0
  const high     = atrPct >= 0.6
  const bias: Bias = elevated ? 'Mixed' : 'Neutral'
  const strength  = elevated ? 4 : high ? 3 : 2
  const signal    = elevated ? 'High — wider stops, smaller size' : high ? 'Elevated' : 'Stable'
  return { name: 'Volatility', bias, strength, signal, source: 'regime-engine' }
}

async function smartMoneyLayer(symbol: string, asset: ConvictionView['asset_class']): Promise<ConvictionLayer> {
  if (asset !== 'crypto') {
    return { name: 'Smart Money', bias: 'N/A', strength: 0, signal: 'Crypto-only signal (Nansen)', source: 'nansen' }
  }
  if (!isNansenConfigured()) {
    return { name: 'Smart Money', bias: 'N/A', strength: 0, signal: 'Nansen not configured', source: 'nansen' }
  }
  try {
    const tokenBase = symbol.toUpperCase().replace(/USDT$/, '')
    const tokens = await tokenScreener({
      chains:    ['ethereum','solana','base'] as NansenChain[],
      timeframe: '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     50,
    })
    const match = tokens.find((t) => t.token_symbol?.toUpperCase() === tokenBase)
    if (!match) {
      return { name: 'Smart Money', bias: 'Neutral', strength: 1, signal: 'Not in SM top-50 this window', source: 'nansen' }
    }
    const net = (match.buy_volume || 0) - (match.sell_volume || 0)
    const bias: Bias = net > 0 ? 'Bullish' : net < 0 ? 'Bearish' : 'Neutral'
    // Strength proxies allocation share of FDV (inflow_fdv_ratio).
    const alloc = Math.max(0, Math.min(1, match.inflow_fdv_ratio ?? 0))
    const strength = 1 + Math.round(alloc * 50 * 4)   // 1..5
    const signal = net > 0
      ? 'Net accumulation (smart-money buys exceed sells)'
      : 'Net distribution (smart-money sells exceed buys)'
    return { name: 'Smart Money', bias, strength: Math.min(5, strength), signal, source: 'nansen' }
  } catch {
    return { name: 'Smart Money', bias: 'N/A', strength: 0, signal: 'Nansen unavailable', source: 'nansen' }
  }
}

async function participationLayer(symbol: string, asset: ConvictionView['asset_class']): Promise<ConvictionLayer> {
  if (asset !== 'crypto') {
    return { name: 'Participation', bias: 'N/A', strength: 0, signal: 'Crypto-only signal (whale flows)', source: 'nansen' }
  }
  if (!isNansenConfigured()) {
    return { name: 'Participation', bias: 'N/A', strength: 0, signal: 'Nansen not configured', source: 'nansen' }
  }
  try {
    const tokenBase = symbol.toUpperCase().replace(/USDT$/, '')
    const tokens = await tokenScreener({
      chains:    ['ethereum','solana','base'] as NansenChain[],
      timeframe: '24h',
      orderBy:   'netflow',
      direction: 'DESC',
      limit:     50,
    })
    const match = tokens.find((t) => t.token_symbol?.toUpperCase() === tokenBase)
    if (!match) {
      return { name: 'Participation', bias: 'Neutral', strength: 1, signal: 'No notable whale activity', source: 'nansen' }
    }
    const flow = match.netflow || 0
    const bias: Bias = flow > 0 ? 'Bullish' : flow < 0 ? 'Bearish' : 'Neutral'
    const intensity = Math.min(5, Math.max(1, Math.round(Math.log10(Math.abs(flow) + 1) - 4)))
    const signal = flow > 0 ? 'Whales accumulating' : flow < 0 ? 'Whales distributing' : 'Whale flow flat'
    return { name: 'Participation', bias, strength: intensity, signal, source: 'nansen' }
  } catch {
    return { name: 'Participation', bias: 'N/A', strength: 0, signal: 'Nansen unavailable', source: 'nansen' }
  }
}

async function macroLayer(asset: ConvictionView['asset_class']): Promise<ConvictionLayer> {
  if (!isAlphaVantageConfigured()) {
    return { name: 'Macro', bias: 'N/A', strength: 0, signal: 'Macro layer not configured', source: 'alphavantage' }
  }
  try {
    const snap = await getMacroSnapshot()
    const cpi  = snap.indicators.find((i) => i.key === 'inflation_yoy')
    const fed  = snap.indicators.find((i) => i.key === 'fed_funds_rate')
    const ten  = snap.indicators.find((i) => i.key === 'treasury_10y')
    if (!cpi || !fed || !ten) {
      return { name: 'Macro', bias: 'N/A', strength: 0, signal: 'Macro indicators incomplete', source: 'alphavantage' }
    }
    // Risk-on conditions: real rate falling (fed flat/falling AND CPI falling),
    // long-end (10Y) softening. Risk-off opposite. Crypto and risk equities key
    // off risk-on; FX/gold respond differently — so the macro layer is most
    // meaningful for crypto/equities/indices.
    const realRateProxy = (fed.latest ?? 0) - (cpi.yoy_change ?? 0)
    const risk_on = ten.trend === 'falling' && fed.trend !== 'rising' && (cpi.trend === 'falling' || (cpi.yoy_change ?? 0) < 3)
    const risk_off = ten.trend === 'rising' && fed.trend === 'rising' && (cpi.yoy_change ?? 0) > 3
    let bias: Bias = 'Neutral'
    let signal = `Real rate proxy ${realRateProxy.toFixed(1)}%, mixed signals`
    if (asset === 'crypto' || asset === 'equity' || asset === 'index') {
      if (risk_on)  { bias = 'Bullish'; signal = 'Risk-on tilt — long-end softening, real rates easing' }
      if (risk_off) { bias = 'Bearish'; signal = 'Risk-off tilt — yields rising, real rates tightening' }
    } else if (asset === 'metal') {
      // Gold inverse to real rates: real rates falling → bullish gold.
      if (risk_on)  { bias = 'Bullish'; signal = 'Real rates easing — constructive for gold' }
      if (risk_off) { bias = 'Bearish'; signal = 'Real rates rising — headwind for gold' }
    } else if (asset === 'forex') {
      // DXY proxy: fed-funds direction; we don't have DXY directly so report neutral
      bias = 'Neutral'
      signal = 'FX bias requires DXY (not yet wired)'
    }
    return { name: 'Macro', bias, strength: bias === 'Neutral' ? 2 : 3, signal, source: 'alphavantage' }
  } catch {
    return { name: 'Macro', bias: 'N/A', strength: 0, signal: 'Macro snapshot unavailable', source: 'alphavantage' }
  }
}

// ── Composite ─────────────────────────────────────────────────────────────

/** Counts Bullish/Bearish/Neutral votes across layers we KNOW, weighted by strength. */
function compose(layers: ConvictionLayer[]): Pick<ConvictionView, 'composite' | 'composite_bias' | 'probability'> {
  const known = layers.filter((l) => l.bias !== 'N/A')
  let bull = 0, bear = 0, neut = 0, mixed = 0
  for (const l of known) {
    const w = Math.max(1, l.strength)
    if (l.bias === 'Bullish') bull += w
    else if (l.bias === 'Bearish') bear += w
    else if (l.bias === 'Neutral') neut += w
    else mixed += w
  }
  const total = bull + bear + neut + mixed || 1
  const dominant = Math.max(bull, bear)
  const ratio = dominant / total       // 0..1
  const composite: Composite =
    ratio >= 0.7 ? 'Very High' :
    ratio >= 0.5 ? 'High' :
    ratio >= 0.35 ? 'Moderate' :
    'Weak'
  const composite_bias: ConvictionView['composite_bias'] =
    bull > bear * 1.2 ? 'Bullish' :
    bear > bull * 1.2 ? 'Bearish' :
    'Neutral'
  const continuation = Math.round((dominant / total) * 100) / 100
  const chop        = Math.round((neut / total)     * 100) / 100
  const fade        = Math.max(0, 1 - continuation - chop)
  return {
    composite,
    composite_bias,
    probability: {
      continuation,
      fade:  Math.round(fade * 100) / 100,
      chop,
    },
  }
}

function buildNarrative(symbol: string, layers: ConvictionLayer[], comp: ReturnType<typeof compose>): string {
  const known = layers.filter((l) => l.bias !== 'N/A')
  const bias = comp.composite_bias.toLowerCase()
  const aligned = known.filter((l) => l.bias === comp.composite_bias).map((l) => l.name).join(', ')
  const contra  = known.filter((l) => (comp.composite_bias === 'Bullish' && l.bias === 'Bearish')
                                     || (comp.composite_bias === 'Bearish' && l.bias === 'Bullish'))
                      .map((l) => l.name)
  const contraStr = contra.length ? ` Watch: ${contra.join(', ')} disagrees.` : ''
  if (comp.composite === 'Weak') {
    return `${symbol}: mixed signals, no high-quality edge.${contraStr}`
  }
  return `${symbol}: ${comp.composite.toLowerCase()} ${bias} conviction. Aligned: ${aligned || 'none'}.${contraStr} ${Math.round(comp.probability.continuation * 100)}% continuation, ${Math.round(comp.probability.fade * 100)}% fade.`
}

// ── Public API ───────────────────────────────────────────────────────────

export async function composeConviction(symbol: string): Promise<ConvictionView> {
  const asset = classifyAsset(symbol)
  const regime = await loadRegime(symbol)

  // Layers in parallel; macro + Nansen are independent of regime.
  const [sm, part, macro] = await Promise.all([
    smartMoneyLayer(symbol, asset),
    participationLayer(symbol, asset),
    macroLayer(asset),
  ])

  const layers: ConvictionLayer[] = [
    momentumLayer(regime),
    regimeLayer(regime),
    volatilityLayer(regime),
    sm,
    part,
    macro,
  ]
  const comp = compose(layers)
  const partial = layers.some((l) => l.bias === 'N/A')
  return {
    symbol,
    asset_class: asset,
    layers,
    ...comp,
    narrative: buildNarrative(symbol, layers, comp),
    generated_at: new Date().toISOString(),
    partial,
  }
}
