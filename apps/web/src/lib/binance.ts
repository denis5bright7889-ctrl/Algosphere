/**
 * Binance public market data — REAL prices, no API key, no auth.
 *
 * Uses only the unauthenticated public endpoints:
 *   • REST   GET api.binance.com/api/v3/ticker/24hr   (snapshot)
 *   • WS     stream.binance.com:9443  combined @ticker (live)
 *
 * This is genuine exchange data. Nothing here is synthetic. When the
 * exchange is unreachable the callers degrade to an honest "stream
 * unavailable" state — they never fabricate a price.
 */

export interface CryptoSymbol {
  /** Binance symbol, e.g. BTCUSDT. */
  symbol: string
  /** Display label. */
  label: string
}

/** The tracked majors + tokenised gold (ties into the FX/Gold desk). */
export const CRYPTO_SYMBOLS: CryptoSymbol[] = [
  { symbol: 'BTCUSDT',  label: 'BTC'  },
  { symbol: 'ETHUSDT',  label: 'ETH'  },
  { symbol: 'SOLUSDT',  label: 'SOL'  },
  { symbol: 'BNBUSDT',  label: 'BNB'  },
  { symbol: 'XRPUSDT',  label: 'XRP'  },
  { symbol: 'DOGEUSDT', label: 'DOGE' },
  { symbol: 'PAXGUSDT', label: 'Gold' },
]

const SYMBOL_SET = new Set(CRYPTO_SYMBOLS.map((s) => s.symbol))
export const LABEL_BY_SYMBOL: Record<string, string> = Object.fromEntries(
  CRYPTO_SYMBOLS.map((s) => [s.symbol, s.label]),
)

/** Normalised ticker the UI renders — exchange-agnostic shape. */
export interface Ticker {
  symbol: string
  label: string
  price: number
  changePct: number
  high: number
  low: number
  quoteVol: number
}

export const REST_URL =
  'https://api.binance.com/api/v3/ticker/24hr?symbols=' +
  encodeURIComponent(JSON.stringify(CRYPTO_SYMBOLS.map((s) => s.symbol)))

export const WS_URL =
  'wss://stream.binance.com:9443/stream?streams=' +
  CRYPTO_SYMBOLS.map((s) => `${s.symbol.toLowerCase()}@ticker`).join('/')

/** Binance /ticker/24hr REST row (subset we consume). */
interface RestRow {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  highPrice: string
  lowPrice: string
  quoteVolume: string
}

/** Binance combined-stream @ticker payload (subset). */
export interface WsTicker {
  s: string  // symbol
  c: string  // last price
  P: string  // price change percent
  h: string  // high
  l: string  // low
  q: string  // quote volume
}

function num(v: string | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function normalizeRest(rows: RestRow[]): Ticker[] {
  return rows
    .filter((r) => SYMBOL_SET.has(r.symbol))
    .map((r) => ({
      symbol: r.symbol,
      label: LABEL_BY_SYMBOL[r.symbol] ?? r.symbol,
      price: num(r.lastPrice),
      changePct: num(r.priceChangePercent),
      high: num(r.highPrice),
      low: num(r.lowPrice),
      quoteVol: num(r.quoteVolume),
    }))
    .sort(
      (a, b) =>
        CRYPTO_SYMBOLS.findIndex((s) => s.symbol === a.symbol) -
        CRYPTO_SYMBOLS.findIndex((s) => s.symbol === b.symbol),
    )
}

export function normalizeWs(d: WsTicker): Ticker | null {
  if (!SYMBOL_SET.has(d.s)) return null
  return {
    symbol: d.s,
    label: LABEL_BY_SYMBOL[d.s] ?? d.s,
    price: num(d.c),
    changePct: num(d.P),
    high: num(d.h),
    low: num(d.l),
    quoteVol: num(d.q),
  }
}
