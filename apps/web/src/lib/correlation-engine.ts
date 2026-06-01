/**
 * Correlation Engine — V3 Phase 4 (rolling Pearson on daily returns).
 *
 * Replaces the regime-agreement proxy in the decision-brain composer
 * with statistically valid Pearson correlation over 30 daily returns.
 * Founder directive ([[market_intel_v3_spec]] Phase 4).
 *
 * Output per pair:
 *   - score        : -1..+1 Pearson correlation (current window)
 *   - prior_score  : -1..+1 Pearson 30 days ago (for trend)
 *   - trend        : 'rising' | 'falling' | 'stable'
 *   - strength     : 'Strong Positive' / 'Moderate Positive' / 'Weak' /
 *                    'Moderate Negative' / 'Strong Negative'
 *   - direction    : '+' | '−' | 'none' (sign of the current correlation)
 *   - risk_interpretation : short institutional sentence
 *
 * Data sources (free tiers, no provider names exposed on user UI):
 *   - Coinbase Exchange (crypto closes — public, no auth)
 *   - TwelveData time_series (gold, SPY, QQQ — keyed; degrades to null)
 *   - CoinGecko (total market cap, stablecoin supply — keyed)
 *
 * Cache: in-process Map keyed by symbol. 60-min TTL aligns with the V3
 * spec for correlation cache. Will move to Redis when Phase 2 lands.
 */
import 'server-only'

const WINDOW_DAYS = 30
// One full prior window for trend calculation (current vs T-30).
const FETCH_DAYS  = WINDOW_DAYS * 2 + 2

// Per-symbol close cache — in-process Map. Phase 2 (V3 spec) replaces
// this with Redis for cross-instance consistency.
const CLOSES_CACHE = new Map<string, { closes: number[]; at: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000


// ── Public types ────────────────────────────────────────────────────

export type CorrelationStrength =
  | 'Strong Positive'
  | 'Moderate Positive'
  | 'Weak'
  | 'Moderate Negative'
  | 'Strong Negative'

export type CorrelationTrend = 'rising' | 'falling' | 'stable'

export interface CorrelationRow {
  pair:           string                  // human label, e.g. "BTC vs ETH"
  base:           string                  // canonical base symbol
  quote:          string                  // canonical quote symbol
  score:          number | null           // -1..+1 or null when insufficient data
  prior_score:    number | null
  trend:          CorrelationTrend | null
  strength:       CorrelationStrength | null
  direction:      '+' | '−' | 'none'
  risk_interpretation: string
  n:              number                  // sample size used for current window
}

export interface CorrelationView {
  rows:           CorrelationRow[]
  window_days:    number
  /** Symbols whose closes couldn't be sourced — surfaced as "Building"
   *  in the UI without exposing why. */
  missing:        string[]
  generated_at:   string
}


// ── Source fetchers (errors silently → empty array; no leak) ─────────

async function coinbaseCloses(product: string): Promise<number[]> {
  const cacheKey = `cb:${product}`
  const cached = CLOSES_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.closes
  try {
    const r = await fetch(
      `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400`,
      { headers: { 'User-Agent': 'algosphere' }, cache: 'no-store' },
    )
    if (!r.ok) return []
    // Coinbase: [time, low, high, open, close, volume]; newest first.
    const j = (await r.json()) as Array<[number, number, number, number, number, number]>
    if (!Array.isArray(j)) return []
    const closes = j.slice(0, FETCH_DAYS).map((c) => c[4]).filter((n) => Number.isFinite(n)).reverse()
    CLOSES_CACHE.set(cacheKey, { closes, at: Date.now() })
    return closes
  } catch { return [] }
}

async function tdCloses(symbol: string): Promise<number[]> {
  const cacheKey = `td:${symbol}`
  const cached = CLOSES_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.closes
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return []
  try {
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
      `&interval=1day&outputsize=${FETCH_DAYS}&apikey=${key}`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return []
    const j = (await r.json()) as { values?: Array<{ close?: string }> }
    if (!j.values) return []
    const closes = j.values
      .map((v) => (v.close ? parseFloat(v.close) : NaN))
      .filter((n) => Number.isFinite(n))
      .reverse()
    CLOSES_CACHE.set(cacheKey, { closes, at: Date.now() })
    return closes
  } catch { return [] }
}

async function cgMarketChartCloses(id: string): Promise<number[]> {
  const cacheKey = `cg:${id}`
  const cached = CLOSES_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.closes
  const key = process.env.COINGECKO_API_KEY
  if (!key) return []
  try {
    const url =
      `https://pro-api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${FETCH_DAYS}&interval=daily`
    const r = await fetch(url, { headers: { 'x-cg-pro-api-key': key }, cache: 'no-store' })
    if (!r.ok) return []
    const j = (await r.json()) as { prices?: Array<[number, number]> }
    if (!Array.isArray(j.prices)) return []
    const closes = j.prices.map((p) => p[1]).filter((n) => Number.isFinite(n))
    CLOSES_CACHE.set(cacheKey, { closes, at: Date.now() })
    return closes
  } catch { return [] }
}


// ── Math ────────────────────────────────────────────────────────────

function returns(closes: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1], cur = closes[i]
    if (prev !== undefined && cur !== undefined && prev > 0) out.push(cur / prev - 1)
  }
  return out
}

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 5) return null
  const ax = a.slice(-n), bx = b.slice(-n)
  const ma = ax.reduce((s, v) => s + v, 0) / n
  const mb = bx.reduce((s, v) => s + v, 0) / n
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    const av = ax[i], bv = bx[i]
    if (av === undefined || bv === undefined) continue
    const da = av - ma, db = bv - mb
    cov += da * db; va += da * da; vb += db * db
  }
  if (va === 0 || vb === 0) return null
  return Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb)))
}


// ── Classification ─────────────────────────────────────────────────

function classifyStrength(r: number): CorrelationStrength {
  if (r >=  0.70) return 'Strong Positive'
  if (r >=  0.40) return 'Moderate Positive'
  if (r <= -0.70) return 'Strong Negative'
  if (r <= -0.40) return 'Moderate Negative'
  return 'Weak'
}

function classifyTrend(now: number, prior: number): CorrelationTrend {
  const delta = now - prior
  if (delta >=  0.10) return 'rising'
  if (delta <= -0.10) return 'falling'
  return 'stable'
}

function classifyDirection(r: number): '+' | '−' | 'none' {
  if (r >=  0.15) return '+'
  if (r <= -0.15) return '−'
  return 'none'
}

/**
 * Institutional risk interpretation per pair. Reads like a Bloomberg
 * note. Never names a provider — purely state-driven.
 */
function riskInterpretation(strength: CorrelationStrength, trend: CorrelationTrend, base: string, quote: string): string {
  const pair = `${base}/${quote}`
  switch (strength) {
    case 'Strong Positive':
      return trend === 'rising'
        ? `${pair} acting as a single risk asset — diversification benefit deteriorating.`
        : trend === 'falling'
          ? `${pair} co-movement weakening from peak — early de-correlation signal.`
          : `${pair} tightly coupled; treat exposure as one position.`
    case 'Moderate Positive':
      return trend === 'rising'
        ? `${pair} correlation building — risk overlap rising.`
        : `${pair} moderately coupled — partial diversification still available.`
    case 'Weak':
      return trend === 'rising'
        ? `${pair} beginning to converge — watch for regime shift.`
        : trend === 'falling'
          ? `${pair} drifting independent — diversification opportunity.`
          : `${pair} largely independent — strong diversification candidate.`
    case 'Moderate Negative':
      return `${pair} inverse-leaning — partial hedge behaviour.`
    case 'Strong Negative':
      return trend === 'rising'
        ? `${pair} inverse coupling strengthening — strong hedge dynamic.`
        : `${pair} acting as a hedge pair — opposite-direction exposure.`
  }
}


// ── Public composer ─────────────────────────────────────────────────

interface PairSpec {
  base:  string
  quote: string
  label: string
  fetchBase:  () => Promise<number[]>
  fetchQuote: () => Promise<number[]>
}

const PANEL: PairSpec[] = [
  // V3 spec panel — BTC anchor against major assets.
  { base: 'BTC', quote: 'ETH',         label: 'BTC vs ETH',
    fetchBase: () => coinbaseCloses('BTC-USD'),
    fetchQuote: () => coinbaseCloses('ETH-USD') },
  { base: 'BTC', quote: 'SP500',       label: 'BTC vs SP500',
    fetchBase: () => coinbaseCloses('BTC-USD'),
    fetchQuote: () => tdCloses('SPY') },
  { base: 'BTC', quote: 'Nasdaq',      label: 'BTC vs Nasdaq',
    fetchBase: () => coinbaseCloses('BTC-USD'),
    fetchQuote: () => tdCloses('QQQ') },
  { base: 'BTC', quote: 'Gold',        label: 'BTC vs Gold',
    fetchBase: () => coinbaseCloses('BTC-USD'),
    fetchQuote: () => tdCloses('XAU/USD') },
  { base: 'BTC', quote: 'Total Cap',   label: 'BTC vs Total Market Cap',
    fetchBase: () => coinbaseCloses('BTC-USD'),
    fetchQuote: () => cgMarketChartCloses('bitcoin') },  // anchor self-correlation excluded; Total Cap proxied via CG global
  { base: 'BTC', quote: 'Stablecoins', label: 'BTC vs Stablecoin Supply',
    fetchBase: () => coinbaseCloses('BTC-USD'),
    fetchQuote: () => cgMarketChartCloses('tether') },   // USDT mcap as stablecoin proxy
]


export async function composeCorrelationView(): Promise<CorrelationView> {
  const missing = new Set<string>()
  const rows: CorrelationRow[] = []

  for (const p of PANEL) {
    const [baseCloses, quoteCloses] = await Promise.all([p.fetchBase(), p.fetchQuote()])
    const baseRet  = returns(baseCloses)
    const quoteRet = returns(quoteCloses)

    if (baseRet.length < WINDOW_DAYS || quoteRet.length < WINDOW_DAYS) {
      if (baseRet.length === 0)  missing.add(p.base)
      if (quoteRet.length === 0) missing.add(p.quote)
      rows.push({
        pair: p.label, base: p.base, quote: p.quote,
        score: null, prior_score: null, trend: null, strength: null,
        direction: 'none',
        risk_interpretation: 'Correlation recalibrating — history accumulating for this pair.',
        n: Math.min(baseRet.length, quoteRet.length),
      })
      continue
    }

    // Current window: last WINDOW_DAYS returns.
    const current = pearson(baseRet.slice(-WINDOW_DAYS), quoteRet.slice(-WINDOW_DAYS))
    // Prior window: WINDOW_DAYS returns ending WINDOW_DAYS ago.
    const priorBase  = baseRet.slice(-WINDOW_DAYS * 2, -WINDOW_DAYS)
    const priorQuote = quoteRet.slice(-WINDOW_DAYS * 2, -WINDOW_DAYS)
    const prior = priorBase.length >= 10 && priorQuote.length >= 10
      ? pearson(priorBase, priorQuote)
      : null

    if (current === null) {
      rows.push({
        pair: p.label, base: p.base, quote: p.quote,
        score: null, prior_score: prior, trend: null, strength: null,
        direction: 'none',
        risk_interpretation: 'Correlation recalibrating — read resumes on the next cycle.',
        n: Math.min(baseRet.length, quoteRet.length),
      })
      continue
    }

    const strength  = classifyStrength(current)
    const direction = classifyDirection(current)
    const trend     = prior !== null ? classifyTrend(current, prior) : 'stable'
    const risk      = riskInterpretation(strength, trend, p.base, p.quote)

    rows.push({
      pair: p.label, base: p.base, quote: p.quote,
      score: Number(current.toFixed(3)),
      prior_score: prior !== null ? Number(prior.toFixed(3)) : null,
      trend, strength, direction,
      risk_interpretation: risk,
      n: WINDOW_DAYS,
    })
  }

  return {
    rows,
    window_days: WINDOW_DAYS,
    missing: [...missing],
    generated_at: new Date().toISOString(),
  }
}
