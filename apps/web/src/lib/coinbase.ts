/**
 * Coinbase Exchange public market data — REAL prices, no API key.
 *
 *   • REST   GET api.exchange.coinbase.com/products/{id}/stats   (snapshot)
 *   • WS     wss://ws-feed.exchange.coinbase.com  (ticker channel)
 *
 * Used as the US-legal fallback for the Binance.com adapter, which is
 * 451-blocked on US IPs. Same `Ticker` shape — the UI is exchange-
 * agnostic. Symbol coverage is a Coinbase-supported subset of the
 * canonical list (no BNB, no PAXG).
 */

import type { MarketSource } from './market-source'
import type { Ticker } from './binance'

interface Product { product_id: string; label: string }

const PRODUCTS: Product[] = [
  { product_id: 'BTC-USD',  label: 'BTC'  },
  { product_id: 'ETH-USD',  label: 'ETH'  },
  { product_id: 'SOL-USD',  label: 'SOL'  },
  { product_id: 'XRP-USD',  label: 'XRP'  },
  { product_id: 'DOGE-USD', label: 'DOGE' },
]

const ORDER: Record<string, number> = Object.fromEntries(
  PRODUCTS.map((p, i) => [p.product_id, i]),
)
const LABEL: Record<string, string> = Object.fromEntries(
  PRODUCTS.map((p) => [p.product_id, p.label]),
)
const REST_BASE = 'https://api.exchange.coinbase.com'
const WS_URL = 'wss://ws-feed.exchange.coinbase.com'

interface Stats { open: string; high: string; low: string; last: string; volume: string }
interface WsTick {
  type: string; product_id: string
  price: string; open_24h: string; high_24h: string; low_24h: string; volume_24h: string
}

function num(v: string | undefined): number {
  const n = Number(v); return Number.isFinite(n) ? n : 0
}

async function fetchOne(p: Product, signal: AbortSignal): Promise<Ticker | null> {
  const res = await fetch(`${REST_BASE}/products/${p.product_id}/stats`, {
    signal, cache: 'no-store', headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Coinbase ${res.status}`)
  const s = (await res.json()) as Stats
  const last = num(s.last); const open = num(s.open)
  if (last <= 0 || open <= 0) return null
  return {
    symbol: p.product_id,
    label: p.label,
    price: last,
    changePct: ((last - open) / open) * 100,
    high: num(s.high),
    low: num(s.low),
    // volume is in base units; convert to quote (USD) with last price.
    quoteVol: num(s.volume) * last,
  }
}

export const coinbaseSource: MarketSource = {
  name: 'coinbase',
  label: 'Coinbase Exchange',

  async fetchSnapshot(signal) {
    const settled = await Promise.allSettled(PRODUCTS.map((p) => fetchOne(p, signal)))
    const rows = settled
      .map((r) => (r.status === 'fulfilled' ? r.value : null))
      .filter((x): x is Ticker => Boolean(x))
    if (rows.length === 0) throw new Error('Coinbase snapshot empty')
    return rows.sort((a, b) => (ORDER[a.symbol] ?? 99) - (ORDER[b.symbol] ?? 99))
  },

  openStream(onTicker, onClose) {
    let ws: WebSocket
    try { ws = new WebSocket(WS_URL) } catch { onClose(); return () => {} }

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: [{ name: 'ticker', product_ids: PRODUCTS.map((p) => p.product_id) }],
        }))
      } catch { /* socket may have died before we could subscribe */ }
    }

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as WsTick
        if (d.type !== 'ticker' || !d.product_id || !LABEL[d.product_id]) return
        const price = num(d.price); const open = num(d.open_24h)
        if (price <= 0 || open <= 0) return
        onTicker({
          symbol: d.product_id,
          label: LABEL[d.product_id]!,
          price,
          changePct: ((price - open) / open) * 100,
          high: num(d.high_24h),
          low: num(d.low_24h),
          quoteVol: num(d.volume_24h) * price,
        })
      } catch { /* ignore malformed frame */ }
    }

    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
    ws.onclose = onClose

    return () => { try { ws.close() } catch { /* noop */ } }
  },
}
