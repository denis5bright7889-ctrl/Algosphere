/**
 * Market Universe — the canonical, typed single source of truth for
 * every instrument the platform knows about.
 *
 * This is the "engine" core: it owns the *taxonomy* (asset class →
 * category → instruments), NOT prices. No quote is ever invented
 * here. Each instrument declares its `dataSource`:
 *
 *   'crypto-stream'  → genuinely live (Binance→Coinbase singleton
 *                      already shipped). Wired, real, ticking.
 *   null             → catalogued only. The instrument is a known,
 *                      addressable part of the universe but NO live
 *                      feed is connected. Consumers MUST render this
 *                      honestly ("feed not connected") — never a
 *                      fabricated price.
 *
 * As real market-data feeds (Polygon / TwelveData / a futures/CFD
 * provider) are credentialed, only the `dataSource` values flip — no
 * consumer rewrite. The crypto leg is derived from the actual
 * streamed symbol set so "live" can never drift from reality.
 */
import { CRYPTO_SYMBOLS } from './binance'

export type AssetClass =
  | 'forex' | 'indices' | 'commodities' | 'futures' | 'stocks' | 'crypto'

export type DataSource = 'crypto-stream' | null

export interface Instrument {
  symbol:     string
  label:      string
  assetClass: AssetClass
  /** Sub-bucket for display (e.g. 'majors', 'metals', 'energy'). */
  group?:     string
  dataSource: DataSource
}

export interface UniverseCategory {
  assetClass: AssetClass
  label:      string
  /** Short honest descriptor of feed status for the UI. */
  blurb:      string
  instruments: Instrument[]
}

const fx = (symbol: string, label: string, group: string): Instrument =>
  ({ symbol, label, assetClass: 'forex', group, dataSource: null })

// ── Crypto — derived from the REAL streamed set (single source of
//    truth with lib/binance). 'Gold' label there = PAXG (tokenised). ──
const CRYPTO: Instrument[] = CRYPTO_SYMBOLS.map((c) => ({
  symbol:     c.symbol,
  label:      c.label === 'Gold' ? 'PAXG' : c.label,
  assetClass: 'crypto' as const,
  group:      c.label === 'Gold' ? 'tokenised' : 'majors',
  dataSource: 'crypto-stream' as const,
}))

export const MARKET_UNIVERSE: UniverseCategory[] = [
  {
    assetClass: 'forex',
    label: 'Forex',
    blurb: 'Majors, minors & crosses. Spot-FX feed not connected.',
    instruments: [
      fx('EURUSD', 'EUR/USD', 'majors'), fx('GBPUSD', 'GBP/USD', 'majors'),
      fx('USDJPY', 'USD/JPY', 'majors'), fx('USDCHF', 'USD/CHF', 'majors'),
      fx('AUDUSD', 'AUD/USD', 'majors'), fx('USDCAD', 'USD/CAD', 'majors'),
      fx('NZDUSD', 'NZD/USD', 'majors'),
      fx('EURGBP', 'EUR/GBP', 'minors'), fx('EURJPY', 'EUR/JPY', 'minors'),
      fx('GBPJPY', 'GBP/JPY', 'minors'),
    ],
  },
  {
    assetClass: 'indices',
    label: 'Indices',
    blurb: 'Global equity index CFDs. Index feed not connected.',
    instruments: [
      { symbol: 'NAS100', label: 'NASDAQ 100', assetClass: 'indices', dataSource: null },
      { symbol: 'SPX500', label: 'S&P 500',    assetClass: 'indices', dataSource: null },
      { symbol: 'US30',   label: 'Dow 30',     assetClass: 'indices', dataSource: null },
      { symbol: 'GER40',  label: 'DAX 40',     assetClass: 'indices', dataSource: null },
      { symbol: 'UK100',  label: 'FTSE 100',   assetClass: 'indices', dataSource: null },
      { symbol: 'JPN225', label: 'Nikkei 225', assetClass: 'indices', dataSource: null },
    ],
  },
  {
    assetClass: 'commodities',
    label: 'Commodities',
    blurb: 'Metals, energy & agriculture. Commodity feed not connected.',
    instruments: [
      { symbol: 'XAUUSD', label: 'Gold',      assetClass: 'commodities', group: 'metals', dataSource: null },
      { symbol: 'XAGUSD', label: 'Silver',    assetClass: 'commodities', group: 'metals', dataSource: null },
      { symbol: 'XPTUSD', label: 'Platinum',  assetClass: 'commodities', group: 'metals', dataSource: null },
      { symbol: 'XPDUSD', label: 'Palladium', assetClass: 'commodities', group: 'metals', dataSource: null },
      { symbol: 'USOIL',  label: 'WTI Crude', assetClass: 'commodities', group: 'energy', dataSource: null },
      { symbol: 'UKOIL',  label: 'Brent',     assetClass: 'commodities', group: 'energy', dataSource: null },
      { symbol: 'NATGAS', label: 'Nat Gas',   assetClass: 'commodities', group: 'energy', dataSource: null },
      { symbol: 'WHEAT',  label: 'Wheat',     assetClass: 'commodities', group: 'agriculture', dataSource: null },
      { symbol: 'CORN',   label: 'Corn',      assetClass: 'commodities', group: 'agriculture', dataSource: null },
      { symbol: 'COFFEE', label: 'Coffee',    assetClass: 'commodities', group: 'agriculture', dataSource: null },
      { symbol: 'COTTON', label: 'Cotton',    assetClass: 'commodities', group: 'agriculture', dataSource: null },
    ],
  },
  {
    assetClass: 'futures',
    label: 'Futures',
    blurb: 'CME/ICE front-month contracts. Futures feed not connected.',
    instruments: [
      { symbol: 'ES', label: 'E-mini S&P',    assetClass: 'futures', dataSource: null },
      { symbol: 'NQ', label: 'E-mini Nasdaq', assetClass: 'futures', dataSource: null },
      { symbol: 'YM', label: 'E-mini Dow',    assetClass: 'futures', dataSource: null },
      { symbol: 'CL', label: 'Crude Oil',     assetClass: 'futures', dataSource: null },
      { symbol: 'GC', label: 'Gold',          assetClass: 'futures', dataSource: null },
      { symbol: 'SI', label: 'Silver',        assetClass: 'futures', dataSource: null },
    ],
  },
  {
    assetClass: 'stocks',
    label: 'Stocks',
    blurb: 'US large-cap equities. Equity feed not connected.',
    instruments: [
      { symbol: 'AAPL', label: 'Apple',     assetClass: 'stocks', dataSource: null },
      { symbol: 'NVDA', label: 'NVIDIA',    assetClass: 'stocks', dataSource: null },
      { symbol: 'TSLA', label: 'Tesla',     assetClass: 'stocks', dataSource: null },
      { symbol: 'AMZN', label: 'Amazon',    assetClass: 'stocks', dataSource: null },
      { symbol: 'META', label: 'Meta',      assetClass: 'stocks', dataSource: null },
      { symbol: 'MSFT', label: 'Microsoft', assetClass: 'stocks', dataSource: null },
    ],
  },
  {
    assetClass: 'crypto',
    label: 'Crypto',
    blurb: 'Live via Binance → Coinbase fallback (real exchange feed).',
    instruments: CRYPTO,
  },
]

export interface CategoryCoverage {
  assetClass: AssetClass
  label:      string
  blurb:      string
  count:      number
  /** True only when at least one instrument has a real connected feed. */
  live:       boolean
  liveCount:  number
}

/** Honest per-category coverage summary for the universe UI. */
export function universeCoverage(): CategoryCoverage[] {
  return MARKET_UNIVERSE.map((c) => {
    const liveCount = c.instruments.filter((i) => i.dataSource !== null).length
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

/** Every instrument that genuinely has a live feed right now. */
export function liveInstruments(): Instrument[] {
  return MARKET_UNIVERSE.flatMap((c) => c.instruments).filter((i) => i.dataSource !== null)
}

export const UNIVERSE_TOTAL = MARKET_UNIVERSE.reduce((n, c) => n + c.instruments.length, 0)
