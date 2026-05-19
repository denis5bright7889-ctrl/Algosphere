/**
 * Market Universe — the canonical, typed single source of truth for
 * every instrument the platform knows about.
 *
 * Each instrument declares which provider WOULD serve its quote
 * (`provider`) plus the symbol that provider uses for it
 * (`providerSymbol`). This file owns design-time taxonomy only; the
 * *effective* live state — i.e. whether a given provider's API key
 * is actually configured on the server right now — is computed
 * separately via `configuredProviders()` so the UI never claims a
 * feed is connected when the key isn't readable.
 *
 *   'crypto-stream' → Binance/Coinbase public WS singleton (no key
 *                     required; always live in practice)
 *   'twelvedata'    → Twelve Data REST (TWELVE_DATA_API_KEY)
 *   'finnhub'       → Finnhub REST (FINNHUB_API_KEY)
 *   null            → catalogued, no provider declared
 *
 * Category order honours the explicit product spec:
 *   1 Forex · 2 Gold (XAUUSD) · 3 Indices · 4 Stocks ·
 *   5 Commodities · 6 Futures · 7 Crypto
 */
import { CRYPTO_SYMBOLS } from './binance'

export type AssetClass =
  | 'forex' | 'gold' | 'indices' | 'stocks' | 'commodities' | 'futures' | 'crypto'

export type Provider = 'crypto-stream' | 'twelvedata' | 'finnhub' | null

export interface Instrument {
  symbol:          string
  label:           string
  assetClass:      AssetClass
  group?:          string
  provider:        Provider
  providerSymbol?: string
}

export interface UniverseCategory {
  assetClass: AssetClass
  label:      string
  blurb:      string
  instruments: Instrument[]
}

// ── Crypto — derived from the REAL streamed set (single source of
//    truth with lib/binance). 'Gold' label there = PAXG (tokenised
//    gold), distinct from XAUUSD spot in the dedicated Gold class.  ──
const CRYPTO: Instrument[] = CRYPTO_SYMBOLS.map((c) => ({
  symbol:         c.symbol,
  label:          c.label === 'Gold' ? 'PAXG' : c.label,
  assetClass:     'crypto' as const,
  group:          c.label === 'Gold' ? 'tokenised' : 'majors',
  provider:       'crypto-stream' as const,
}))

const fx = (symbol: string, label: string, group: string, td: string): Instrument =>
  ({ symbol, label, assetClass: 'forex', group, provider: 'twelvedata', providerSymbol: td })

const idx = (symbol: string, label: string, td: string): Instrument =>
  ({ symbol, label, assetClass: 'indices', provider: 'twelvedata', providerSymbol: td })

const stk = (symbol: string, label: string): Instrument =>
  // Finnhub is faster on US equities (free tier real-time); the
  // orchestrator will fall through to Twelve Data if Finnhub isn't
  // keyed.
  ({ symbol, label, assetClass: 'stocks', provider: 'finnhub', providerSymbol: symbol })

const cmd = (symbol: string, label: string, group: string, td: string | null): Instrument =>
  ({ symbol, label, assetClass: 'commodities', group, provider: td ? 'twelvedata' : null, providerSymbol: td ?? undefined })

// Futures: free-tier coverage from Twelve Data / Finnhub is unreliable
// for CME front-month contracts. Catalogued honestly; provider stays
// null until a dedicated futures feed is wired.
const fut = (symbol: string, label: string): Instrument =>
  ({ symbol, label, assetClass: 'futures', provider: null })

export const MARKET_UNIVERSE: UniverseCategory[] = [
  {
    assetClass: 'forex',
    label: 'Forex',
    blurb: 'Majors, minors & crosses — quoted via Twelve Data.',
    instruments: [
      fx('EURUSD', 'EUR/USD', 'majors', 'EUR/USD'),
      fx('GBPUSD', 'GBP/USD', 'majors', 'GBP/USD'),
      fx('USDJPY', 'USD/JPY', 'majors', 'USD/JPY'),
      fx('USDCHF', 'USD/CHF', 'majors', 'USD/CHF'),
      fx('AUDUSD', 'AUD/USD', 'majors', 'AUD/USD'),
      fx('USDCAD', 'USD/CAD', 'majors', 'USD/CAD'),
      fx('NZDUSD', 'NZD/USD', 'majors', 'NZD/USD'),
      fx('EURGBP', 'EUR/GBP', 'minors', 'EUR/GBP'),
      fx('EURJPY', 'EUR/JPY', 'minors', 'EUR/JPY'),
      fx('GBPJPY', 'GBP/JPY', 'minors', 'GBP/JPY'),
    ],
  },
  {
    assetClass: 'gold',
    label: 'Gold',
    blurb: 'Spot gold (XAUUSD) — the platform\'s flagship metal — quoted via Twelve Data.',
    instruments: [
      { symbol: 'XAUUSD', label: 'Gold (Spot)', assetClass: 'gold', provider: 'twelvedata', providerSymbol: 'XAU/USD' },
    ],
  },
  {
    assetClass: 'indices',
    label: 'Indices',
    blurb: 'Global equity indices — quoted via Twelve Data (free-tier coverage varies by exchange).',
    instruments: [
      idx('NAS100', 'NASDAQ 100', 'NDX'),
      idx('SPX500', 'S&P 500',    'SPX'),
      idx('US30',   'Dow 30',     'DJI'),
      idx('GER40',  'DAX 40',     'DAX'),
      idx('UK100',  'FTSE 100',   'UKX'),
      idx('JPN225', 'Nikkei 225', 'N225'),
    ],
  },
  {
    assetClass: 'stocks',
    label: 'Stocks',
    blurb: 'US large-cap equities — quoted via Finnhub (Twelve Data fallback).',
    instruments: [
      stk('AAPL', 'Apple'),
      stk('NVDA', 'NVIDIA'),
      stk('TSLA', 'Tesla'),
      stk('AMZN', 'Amazon'),
      stk('META', 'Meta'),
      stk('MSFT', 'Microsoft'),
    ],
  },
  {
    assetClass: 'commodities',
    label: 'Commodities',
    blurb: 'Metals (ex. gold), energy & agriculture — partial Twelve Data coverage; uncovered rows stay catalogued.',
    instruments: [
      cmd('XAGUSD', 'Silver',    'metals',      'XAG/USD'),
      cmd('XPTUSD', 'Platinum',  'metals',      'XPT/USD'),
      cmd('XPDUSD', 'Palladium', 'metals',      'XPD/USD'),
      cmd('USOIL',  'WTI Crude', 'energy',      'WTI/USD'),
      cmd('UKOIL',  'Brent',     'energy',      'BCO/USD'),
      cmd('NATGAS', 'Nat Gas',   'energy',      null),
      cmd('WHEAT',  'Wheat',     'agriculture', null),
      cmd('CORN',   'Corn',      'agriculture', null),
      cmd('COFFEE', 'Coffee',    'agriculture', null),
      cmd('COTTON', 'Cotton',    'agriculture', null),
    ],
  },
  {
    assetClass: 'futures',
    label: 'Futures',
    blurb: 'CME/ICE front-month contracts — no free-tier provider; catalogued only.',
    instruments: [
      fut('ES', 'E-mini S&P'),
      fut('NQ', 'E-mini Nasdaq'),
      fut('YM', 'E-mini Dow'),
      fut('CL', 'Crude Oil'),
      fut('GC', 'Gold'),
      fut('SI', 'Silver'),
    ],
  },
  {
    assetClass: 'crypto',
    label: 'Crypto',
    blurb: 'Live via Binance → Coinbase fallback (public WS, no key required).',
    instruments: CRYPTO,
  },
]

// ─── Effective-live computation (env-aware, server-only) ────────────

/**
 * Set of providers whose API key is configured server-side RIGHT NOW.
 * Server-only — never call from a client component (non-NEXT_PUBLIC_*
 * env values aren't exposed to the browser bundle).
 */
export function configuredProviders(): Set<Provider> {
  const s = new Set<Provider>(['crypto-stream'])
  if (process.env.TWELVE_DATA_API_KEY) s.add('twelvedata')
  if (process.env.FINNHUB_API_KEY)    s.add('finnhub')
  return s
}

export function effectiveLive(inst: Instrument, configured: Set<Provider>): boolean {
  return inst.provider != null && configured.has(inst.provider)
}

export interface CategoryCoverage {
  assetClass: AssetClass
  label:      string
  blurb:      string
  count:      number
  live:       boolean
  liveCount:  number
}

/** Honest per-category coverage — caller passes configuredProviders(). */
export function universeCoverage(configured?: Set<Provider>): CategoryCoverage[] {
  const cfg = configured ?? configuredProviders()
  return MARKET_UNIVERSE.map((c) => {
    const liveCount = c.instruments.filter((i) => effectiveLive(i, cfg)).length
    return {
      assetClass: c.assetClass,
      label:      c.label,
      blurb:      c.blurb,
      count:      c.instruments.length,
      live:       liveCount > 0,
      liveCount,
    }
  })
}

export function liveInstruments(configured?: Set<Provider>): Instrument[] {
  const cfg = configured ?? configuredProviders()
  return MARKET_UNIVERSE.flatMap((c) => c.instruments).filter((i) => effectiveLive(i, cfg))
}

export const UNIVERSE_TOTAL = MARKET_UNIVERSE.reduce((n, c) => n + c.instruments.length, 0)
