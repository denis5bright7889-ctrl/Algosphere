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
 *
 * Implements the cross-exchange `MarketSource` contract — the UI is
 * source-agnostic and can fall back to coinbase.ts on regional
 * geoblocking (Binance.com returns 451 on US egress).
 */
import type { MarketSource } from './market-source'

export interface CryptoSymbol {
  /** Binance symbol, e.g. BTCUSDT. */
  symbol: string
  /** Display label. */
  label: string
}

/**
 * The tracked crypto universe — aligned 2026-06 with the signal engine's
 * scan list (apps/signal-engine/config.py). Previously the web showed
 * BNB + PAXG which the engine never scanned, creating UI drift where
 * users pinned crypto they couldn't get tradable signals for. Now both
 * sides quote the same 10 instruments. Binance streams live ticks; the
 * engine fetches OHLCV from Coinbase (US-region safe).
 */
export const CRYPTO_SYMBOLS: CryptoSymbol[] = [
  { symbol: 'BTCUSDT',  label: 'BTC'  },
  { symbol: 'ETHUSDT',  label: 'ETH'  },
  { symbol: 'SOLUSDT',  label: 'SOL'  },
  { symbol: 'XRPUSDT',  label: 'XRP'  },
  { symbol: 'ADAUSDT',  label: 'ADA'  },
  { symbol: 'AVAXUSDT', label: 'AVAX' },
  { symbol: 'LINKUSDT', label: 'LINK' },
  { symbol: 'LTCUSDT',  label: 'LTC'  },
  { symbol: 'DOTUSDT',  label: 'DOT'  },
  { symbol: 'DOGEUSDT', label: 'DOGE' },
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

export const binanceSource: MarketSource = {
  name: 'binance',
  label: 'Binance',

  async fetchSnapshot(signal) {
    const res = await fetch(REST_URL, {
      signal, cache: 'no-store', headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`Binance ${res.status}`)
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows)) throw new Error('Binance snapshot malformed')
    const out = normalizeRest(rows)
    if (out.length === 0) throw new Error('Binance snapshot empty')
    return out
  },

  openStream(onTicker, onClose) {
    let ws: WebSocket
    try { ws = new WebSocket(WS_URL) } catch { onClose(); return () => {} }

    ws.onmessage = (ev) => {
      try {
        const env = JSON.parse(ev.data as string) as { data?: WsTicker }
        if (!env?.data) return
        const t = normalizeWs(env.data)
        if (t) onTicker(t)
      } catch { /* ignore malformed frame */ }
    }
    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
    ws.onclose = onClose

    return () => { try { ws.close() } catch { /* noop */ } }
  },
}
