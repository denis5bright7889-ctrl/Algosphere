/**
 * GET /api/market/correlations — Pearson correlation of daily returns over
 * the last 30 trading days, across the pairs we can source HISTORICAL data
 * for on free tiers:
 *   • Crypto closes  → Coinbase Exchange candles (US-safe; Binance 451s US).
 *   • Gold / EUR-USD → Twelve Data time_series (free tier covers FX/metals).
 *
 * Equity-index / DXY / VIX correlations are intentionally NOT here: no free
 * historical feed serves them (Finnhub's candle endpoint is paid; Twelve
 * Data indices/DXY are paid). Showing them as permanent nulls would be
 * misleading, so the set is scoped to genuinely computable pairs and the
 * UI notes the limitation. Both upstreams use a 6h revalidate cache.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS  = 30
const REVALIDATE_S = 21_600 // 6h

async function coinbaseCloses(product: string): Promise<number[]> {
  try {
    const r = await fetch(
      `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400`,
      { headers: { 'User-Agent': 'algosphere' }, next: { revalidate: REVALIDATE_S } },
    )
    if (!r.ok) return []
    // Coinbase candle = [time, low, high, open, close, volume]; newest first.
    const j = (await r.json()) as Array<[number, number, number, number, number, number]>
    if (!Array.isArray(j)) return []
    return j.slice(0, WINDOW_DAYS + 1).map((c) => c[4]).filter((n) => Number.isFinite(n)).reverse()
  } catch { return [] }
}

async function tdCloses(symbol: string): Promise<number[]> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return []
  try {
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
      `&interval=1day&outputsize=${WINDOW_DAYS + 1}&apikey=${key}`
    const r = await fetch(url, { next: { revalidate: REVALIDATE_S } })
    if (!r.ok) return []
    const j = (await r.json()) as { values?: Array<{ close?: string }> }
    if (!j.values) return []
    return j.values
      .map((v) => (v.close ? parseFloat(v.close) : NaN))
      .filter((n) => Number.isFinite(n))
      .reverse()
  } catch { return [] }
}

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

// Scoped to one TD call (gold) + Coinbase crypto so the whole matrix is
// reliable — chaining two TD time_series calls throttles on the free tier
// (one wins the per-minute credit race, the other returns empty).
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['BTC', 'ETH',     'BTC vs ETH'],
  ['BTC', 'SOL',     'BTC vs SOL'],
  ['ETH', 'SOL',     'ETH vs SOL'],
  ['BTC', 'XAU/USD', 'BTC vs Gold'],
  ['ETH', 'XAU/USD', 'ETH vs Gold'],
  ['SOL', 'XAU/USD', 'SOL vs Gold'],
]

export async function GET() {
  const [btc, eth, sol, gold] = await Promise.all([
    coinbaseCloses('BTC-USD'),
    coinbaseCloses('ETH-USD'),
    coinbaseCloses('SOL-USD'),
    tdCloses('XAU/USD'),
  ])
  const series: Record<string, number[]> = {
    BTC: returns(btc), ETH: returns(eth), SOL: returns(sol),
    'XAU/USD': returns(gold),
  }

  const matrix = PAIRS.map(([a, b, pair]) => {
    const ar = series[a] ?? [], br = series[b] ?? []
    return { pair, a, b, correlation: pearson(ar, br), n: Math.min(ar.length, br.length) }
  })

  return NextResponse.json(
    { matrix, window_days: WINDOW_DAYS, generated_at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600' } },
  )
}
