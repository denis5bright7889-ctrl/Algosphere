import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Candle-history proxy for the live crypto chart.
 *
 * The chart used to fetch Binance/Coinbase REST directly from the
 * browser — which is routinely CORS-blocked or geo-blocked, leaving an
 * empty "couldn't load history" chart. Fetching server-side fixes both:
 * no CORS, and the server egress isn't subject to the user's regional
 * block. Binance first, Coinbase fallback. Honest empty on failure —
 * never fabricated candles.
 *
 * GET /api/market/klines?symbol=BTCUSDT&tf=1m
 */
const TF_BINANCE: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h' }
const TF_CB_GRAN: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 }
const LIMIT = 150
const TIMEOUT_MS = 6000

interface Candle { time: number; open: number; high: number; low: number; close: number }

async function withTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fromBinance(symbol: string, tf: string): Promise<Candle[]> {
  const r = await withTimeout(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${TF_BINANCE[tf]}&limit=${LIMIT}`,
  )
  if (!r || !r.ok) return []
  const rows = (await r.json().catch(() => null)) as unknown[][] | null
  if (!Array.isArray(rows)) return []
  return rows.map((k) => ({
    time:  Number(k[0]),
    open:  Number(k[1]),
    high:  Number(k[2]),
    low:   Number(k[3]),
    close: Number(k[4]),
  })).filter((c) => Number.isFinite(c.close))
}

async function fromCoinbase(symbol: string, tf: string): Promise<Candle[]> {
  const base = symbol.replace(/USDT$|USDC$|USD$/i, '')
  const r = await withTimeout(
    `https://api.exchange.coinbase.com/products/${encodeURIComponent(base)}-USD/candles?granularity=${TF_CB_GRAN[tf]}`,
  )
  if (!r || !r.ok) return []
  const rows = (await r.json().catch(() => null)) as number[][] | null
  if (!Array.isArray(rows)) return []
  // Coinbase: [time(s), low, high, open, close, volume], newest-first.
  const out: Candle[] = []
  for (const c of rows) {
    if (!Array.isArray(c) || c.length < 5) continue
    const t = Number(c[0]), low = Number(c[1]), high = Number(c[2])
    const open = Number(c[3]), close = Number(c[4])
    if (![t, low, high, open, close].every(Number.isFinite)) continue
    out.push({ time: t * 1000, open, high, low, close })
  }
  return out.sort((a, b) => a.time - b.time).slice(-LIMIT)
}

export async function GET(req: Request) {
  const url    = new URL(req.url)
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const tf     = url.searchParams.get('tf') ?? '1m'

  if (!symbol)            return NextResponse.json({ candles: [], error: 'symbol required' }, { status: 400 })
  if (!(tf in TF_BINANCE)) return NextResponse.json({ candles: [], error: 'bad tf' }, { status: 400 })

  let candles = await fromBinance(symbol, tf)
  let source: 'binance' | 'coinbase' | 'none' = candles.length ? 'binance' : 'none'
  if (!candles.length) {
    candles = await fromCoinbase(symbol, tf)
    if (candles.length) source = 'coinbase'
  }

  return NextResponse.json(
    { candles, source, count: candles.length },
    // brief CDN cache so repeated opens don't refetch; candles are
    // coarse enough that 20s staleness is invisible.
    { headers: { 'cache-control': 'public, max-age=20' } },
  )
}
