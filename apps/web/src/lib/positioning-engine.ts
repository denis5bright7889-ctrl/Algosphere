/**
 * Positioning Engine — leverage / crowding / liquidation risk.
 *
 * Per the brief Section 11: detect overcrowded longs, panic shorts,
 * leverage buildup, liquidation pressure, euphoric positioning — and
 * expose institutional state labels, never raw funding-rate numbers.
 *
 * Source: Bybit V5 public REST API (no auth required, no rate-limit
 * concerns at our query volume). Pull is per-symbol via the linear-
 * perp ticker endpoint, which returns `fundingRate` + `openInterest` +
 * `openInterestValue` in one call.
 *
 * Why Bybit specifically:
 *   - Binance derivatives REST 451s the Railway us-west IP (same geo
 *     issue as spot). Bybit is reachable globally.
 *   - Bybit's perps have deep liquidity for the universe we already
 *     surface elsewhere (BTC/ETH/SOL/...), so positioning data is
 *     representative of the broader market.
 *
 * Honesty rules (same pattern as Conviction / Stress / Momentum):
 *   - per-symbol returns `state='Unknown'` with reason when the API
 *     call fails — never fabricated
 *   - OI is reported as a level (`oi_usd`) only — we don't claim
 *     'buildup' without historical context (would need a snapshot
 *     store, which is the Adaptive Intelligence Phase A work)
 *   - composite excludes Unknown rows from the universe-level read
 */
import 'server-only'

const BYBIT_BASE = 'https://api.bybit.com/v5/market/tickers'

export type PositioningState =
  | 'Euphoric Long'      // funding extreme positive — overcrowded long, mean-reversion risk
  | 'Crowded Long'       // funding meaningfully positive
  | 'Balanced'           // funding near zero
  | 'Crowded Short'      // funding meaningfully negative
  | 'Panic Short'        // funding extreme negative — capitulation / squeeze setup
  | 'Unknown'

export interface PositioningView {
  symbol:        string
  state:         PositioningState
  /** Annualised funding-rate proxy (Bybit reports per 8h; we annualise for readability). */
  annualised_funding_pct: number | null
  /** Open interest in USD — a level, not a delta. */
  oi_usd:        number | null
  /** Categorical OI scale relative to its peer universe. */
  oi_scale:      'Mega' | 'Large' | 'Mid' | 'Small' | 'N/A'
  /** Composite leverage-stress score 0..100; high = unstable positioning. */
  stress_score:  number
  signal:        string
  generated_at:  string
}

export interface PositioningBoard {
  views:         PositioningView[]
  /** Universe-level summary derived from the per-asset reads. */
  summary: {
    label:       'Long-skewed' | 'Short-skewed' | 'Balanced' | 'Unknown'
    score:       number      // 0..100 — net crowding intensity
    narrative:   string
  }
  partial:       boolean
  generated_at:  string
}

// ── Tunable thresholds ──────────────────────────────────────────────────
//
// Bybit funding rates reset every 8h, so the per-cycle rate × 3 × 365 ≈
// annualised. Empirically:
//   |annualised| < 8%   → Balanced
//   8-22%               → Crowded
//   > 22%               → Euphoric / Panic (state-of-the-cycle extremes)

const ANN_BAND_CROWD    = 8
const ANN_BAND_EUPHORIC = 22

// Universe basket — top liquidity perps that mirror our scan universe.
const BASKET = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
  'LTCUSDT', 'MATICUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT',
]

// ── Fetchers ────────────────────────────────────────────────────────────

interface BybitTicker {
  symbol:            string
  fundingRate:       string
  openInterest:      string
  openInterestValue: string
}

async function fetchTicker(symbol: string): Promise<BybitTicker | null> {
  try {
    const r = await fetch(`${BYBIT_BASE}?category=linear&symbol=${symbol}`, {
      // Bybit funding rates update every 8h; OI moves slower than seconds.
      // 90s cache balances freshness vs request volume against the API.
      next: { revalidate: 90 },
    })
    if (!r.ok) return null
    const j = (await r.json()) as { result?: { list?: BybitTicker[] } }
    return j.result?.list?.[0] ?? null
  } catch {
    return null
  }
}

// ── Per-asset classification ────────────────────────────────────────────

function stateFromFunding(annualisedPct: number): PositioningState {
  if (annualisedPct >  ANN_BAND_EUPHORIC) return 'Euphoric Long'
  if (annualisedPct >  ANN_BAND_CROWD)    return 'Crowded Long'
  if (annualisedPct < -ANN_BAND_EUPHORIC) return 'Panic Short'
  if (annualisedPct < -ANN_BAND_CROWD)    return 'Crowded Short'
  return 'Balanced'
}

function oiScale(oi: number, max: number): PositioningView['oi_scale'] {
  if (!Number.isFinite(oi) || oi <= 0) return 'N/A'
  const ratio = oi / Math.max(max, 1)
  if (ratio >= 0.5)  return 'Mega'
  if (ratio >= 0.15) return 'Large'
  if (ratio >= 0.04) return 'Mid'
  return 'Small'
}

function stressFor(state: PositioningState, annPct: number): number {
  // Stress is the absolute funding pressure mapped to 0..100, with extra
  // weight to the euphoric/panic bands (those are mean-reversion-prone).
  const base = Math.min(100, Math.round((Math.abs(annPct) / ANN_BAND_EUPHORIC) * 80))
  const tail = state === 'Euphoric Long' || state === 'Panic Short' ? 15 : 0
  return Math.min(100, base + tail)
}

function narrate(state: PositioningState, sym: string, ann: number): string {
  const tag = sym.replace(/USDT$/, '')
  switch (state) {
    case 'Euphoric Long':  return `${tag}: euphoric long positioning (~${ann.toFixed(1)}% annualised) — squeeze / mean-reversion risk elevated.`
    case 'Crowded Long':   return `${tag}: crowded long positioning. Trades-with-trend get expensive funding cost.`
    case 'Balanced':       return `${tag}: positioning balanced, no extreme on either side.`
    case 'Crowded Short':  return `${tag}: crowded short positioning. Short squeeze setup if the tape lifts.`
    case 'Panic Short':    return `${tag}: panic short positioning — capitulation pricing, squeeze risk material.`
    default:               return `${tag}: positioning unknown — Bybit feed unavailable.`
  }
}

function buildView(symbol: string, t: BybitTicker | null, maxOi: number, nowIso: string): PositioningView {
  if (!t) {
    return {
      symbol,
      state:              'Unknown',
      annualised_funding_pct: null,
      oi_usd:             null,
      oi_scale:           'N/A',
      stress_score:       0,
      signal:             `${symbol}: positioning unknown — Bybit feed unavailable.`,
      generated_at:       nowIso,
    }
  }
  const perCycle = parseFloat(t.fundingRate)        // per 8h
  const ann      = perCycle * 3 * 365 * 100         // annualised %
  const oi       = parseFloat(t.openInterestValue)
  const state    = stateFromFunding(ann)
  return {
    symbol,
    state,
    annualised_funding_pct: Number.isFinite(ann) ? Number(ann.toFixed(2)) : null,
    oi_usd:                 Number.isFinite(oi)  ? Math.round(oi)        : null,
    oi_scale:               oiScale(oi, maxOi),
    stress_score:           stressFor(state, ann),
    signal:                 narrate(state, symbol, ann),
    generated_at:           nowIso,
  }
}

// ── Universe summary ────────────────────────────────────────────────────

function summarise(views: PositioningView[]): PositioningBoard['summary'] {
  const known = views.filter((v) => v.state !== 'Unknown' && v.annualised_funding_pct !== null)
  if (known.length === 0) {
    return { label: 'Unknown', score: 0, narrative: 'Bybit feed unavailable — positioning summary deferred.' }
  }
  // OI-weighted funding bias: a tiny altcoin's funding shouldn't outvote BTC.
  let weightedSum = 0
  let totalWeight = 0
  for (const v of known) {
    const w = Math.max(1, (v.oi_usd ?? 1))
    weightedSum += (v.annualised_funding_pct ?? 0) * w
    totalWeight += w
  }
  const biasPct = totalWeight > 0 ? weightedSum / totalWeight : 0
  const score   = Math.min(100, Math.round(Math.abs(biasPct) / ANN_BAND_EUPHORIC * 100))
  const label   =
    biasPct >  ANN_BAND_CROWD / 2 ? 'Long-skewed' :
    biasPct < -ANN_BAND_CROWD / 2 ? 'Short-skewed' :
    'Balanced'
  const narrative =
    label === 'Long-skewed'  ? `Universe positioning long-skewed (~${biasPct.toFixed(1)}% annualised funding, OI-weighted). Trend-with trades carry funding cost.` :
    label === 'Short-skewed' ? `Universe positioning short-skewed (~${biasPct.toFixed(1)}% annualised funding, OI-weighted). Squeeze setups possible.` :
                                'Universe positioning balanced — no systemic crowding either direction.'
  return { label, score, narrative }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function composePositioningBoard(symbols?: string[]): Promise<PositioningBoard> {
  const list = (symbols && symbols.length ? symbols : BASKET).map((s) => s.toUpperCase())
  const tickers = await Promise.all(list.map((s) => fetchTicker(s)))
  const nowIso = new Date().toISOString()

  // First pass — read raw OI to determine the scale-buckets.
  const ois = tickers.map((t) => (t ? parseFloat(t.openInterestValue) : 0)).filter((n) => Number.isFinite(n) && n > 0)
  const maxOi = ois.length ? Math.max(...ois) : 0

  const views = list.map((s, i) => buildView(s, tickers[i] ?? null, maxOi, nowIso))
  const summary = summarise(views)
  const partial = views.some((v) => v.state === 'Unknown')
  return { views, summary, partial, generated_at: nowIso }
}
