/**
 * TradingView symbol-mapping layer.
 *
 * Maps the platform's internal instrument symbols (BTCUSDT, EURUSD,
 * XAUUSD, NAS100, …) to the exchange-prefixed symbols the TradingView
 * Advanced Chart widget expects (BINANCE:BTCUSDT, FX:EURUSD,
 * OANDA:XAUUSD, CAPITALCOM:US100, …).
 *
 * Pure, isomorphic (safe in client + server). Returns `null` for
 * instruments TradingView can't chart (catalogued-only futures/bonds
 * with no clean TV continuous symbol, crypto vol indices, …) so the UI
 * can honestly say "chart unavailable" instead of rendering a broken
 * widget. We never fabricate a symbol that resolves to the wrong market.
 */
import type { AssetClass } from './market-universe'

// ── Timeframes ─────────────────────────────────────────────────────────
// Widget `interval` codes: minutes as numbers, then 'D'/'W'.
export interface Timeframe {
  label:    string   // shown on the switcher
  interval: string   // TradingView widget interval code
}
export const TIMEFRAMES: Timeframe[] = [
  { label: '1m',  interval: '1'   },
  { label: '5m',  interval: '5'   },
  { label: '15m', interval: '15'  },
  { label: '1h',  interval: '60'  },
  { label: '4h',  interval: '240' },
  { label: '1D',  interval: 'D'   },
  { label: '1W',  interval: 'W'   },
]
export const DEFAULT_INTERVAL = '60'

// The engine scans on this timeframe; the intel panels are computed off
// it, so we label them honestly when the chart TF differs.
export const ENGINE_TIMEFRAME_LABEL = '1h'

// ── Explicit per-symbol overrides ───────────────────────────────────────
// Highest-priority map: anything here wins over the class heuristics.
const OVERRIDES: Record<string, string> = {
  // Metals (spot) — OANDA carries clean 24/5 spot symbols.
  XAUUSD: 'OANDA:XAUUSD',
  XAGUSD: 'OANDA:XAGUSD',
  XPTUSD: 'OANDA:XPTUSD',
  XPDUSD: 'OANDA:XPDUSD',
}

// Indices → CapitalCom CFD symbols (reliable, chart nearly 24/5).
const INDEX_MAP: Record<string, string> = {
  NAS100: 'CAPITALCOM:US100',
  SPX500: 'CAPITALCOM:US500',
  US30:   'CAPITALCOM:US30',
  GER40:  'CAPITALCOM:DE40',
  UK100:  'CAPITALCOM:UK100',
  JPN225: 'CAPITALCOM:J225',
}

// Commodities (ex-spot-metals, which live in OVERRIDES).
const COMMODITY_MAP: Record<string, string> = {
  USOIL:   'TVC:USOIL',
  UKOIL:   'TVC:UKOIL',
  NATGAS:  'CAPITALCOM:NATURALGAS',
  XCUUSD:  'CAPITALCOM:COPPER',
  WHEAT:   'CAPITALCOM:WHEAT',
  CORN:    'CAPITALCOM:CORN',
  SOYBEAN: 'CAPITALCOM:SOYBEAN',
  SUGAR:   'CAPITALCOM:SUGAR',
  COFFEE:  'CAPITALCOM:COFFEE',
  COCOA:   'CAPITALCOM:COCOA',
  COTTON:  'CAPITALCOM:COTTON',
}

// Futures → TradingView continuous front-month (`1!`).
const FUTURES_MAP: Record<string, string> = {
  ES: 'CME_MINI:ES1!',
  NQ: 'CME_MINI:NQ1!',
  YM: 'CBOT_MINI:YM1!',
  CL: 'NYMEX:CL1!',
  GC: 'COMEX:GC1!',
  SI: 'COMEX:SI1!',
}

// Sovereign yields → TVC government-bond symbols.
const BOND_MAP: Record<string, string> = {
  US10Y: 'TVC:US10Y',
  US02Y: 'TVC:US02Y',
  US30Y: 'TVC:US30Y',
  UK10Y: 'TVC:GB10Y',
  DE10Y: 'TVC:DE10Y',
  JP10Y: 'TVC:JP10Y',
}

// Volatility — only the indices TradingView actually carries.
const VOL_MAP: Record<string, string> = {
  VIX:  'TVC:VIX',
  VVIX: 'CBOE:VVIX',
  // DVOL / BVIV: no clean TV symbol → not chartable (returns null).
}

/** Binance uses USDT quotes — normalise bare/USD-quoted coins to it. */
function normalizeCrypto(s: string): string {
  if (s.endsWith('USDT')) return s
  if (s.endsWith('USDC')) return s.slice(0, -4) + 'USDT'
  if (s.endsWith('USD'))  return s.slice(0, -3) + 'USDT'
  return s + 'USDT'
}

/**
 * Map an internal symbol to a TradingView symbol. `assetClass` makes the
 * mapping exact; without it we fall back to shape heuristics (6-letter FX
 * pair, USDT-quoted crypto). Returns null when not chartable.
 */
export function toTradingViewSymbol(rawSymbol: string, assetClass?: AssetClass): string | null {
  const symbol = rawSymbol.toUpperCase().replace('/', '').trim()
  if (!symbol) return null

  if (OVERRIDES[symbol]) return OVERRIDES[symbol]

  switch (assetClass) {
    case 'crypto':      return `BINANCE:${normalizeCrypto(symbol)}`
    case 'forex':       return `FX:${symbol}`
    case 'gold':        return 'OANDA:XAUUSD'
    case 'indices':     return INDEX_MAP[symbol]     ?? null
    case 'stocks':      return `NASDAQ:${symbol}`
    case 'commodities': return COMMODITY_MAP[symbol] ?? null
    case 'futures':     return FUTURES_MAP[symbol]   ?? null
    case 'bonds':       return BOND_MAP[symbol]      ?? null
    case 'volatility':  return VOL_MAP[symbol]       ?? null
    default: break
  }

  // No class hint — infer from the symbol shape.
  if (INDEX_MAP[symbol])     return INDEX_MAP[symbol]
  if (COMMODITY_MAP[symbol]) return COMMODITY_MAP[symbol]
  if (VOL_MAP[symbol])       return VOL_MAP[symbol]
  if (/USDT?$|USDC$/.test(symbol)) return `BINANCE:${normalizeCrypto(symbol)}`
  if (/^[A-Z]{6}$/.test(symbol))   return `FX:${symbol}` // looks like a forex pair
  return null
}

/** Can this instrument be charted by the TradingView widget? */
export function isChartable(symbol: string, assetClass?: AssetClass): boolean {
  return toTradingViewSymbol(symbol, assetClass) !== null
}

/** Human label for a TradingView interval code (reverse of TIMEFRAMES). */
export function intervalLabel(interval: string): string {
  return TIMEFRAMES.find((t) => t.interval === interval)?.label ?? interval
}
