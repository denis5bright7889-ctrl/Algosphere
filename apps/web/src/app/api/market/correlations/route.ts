/**
 * GET /api/market/correlations — Pearson correlation matrix across the
 * curated cross-asset pair set the brief calls out (BTC↔Gold, DXY↔EURUSD,
 * NASDAQ↔Crypto, Yields↔Stocks-by-proxy, VIX↔S&P, …).
 *
 * Computed from 30 daily closing prices per series — Binance klines for
 * crypto (keyless), Twelve Data time_series for forex/indices/gold/vix
 * (TWELVE_DATA_API_KEY). Both upstream fetches use Next's revalidate cache
 * (6h) so daily-data correlations don't hammer either provider on page
 * loads. A pair returns correlation: null when either side is short on
 * data (e.g. provider down, key missing).
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TD_DAILY = ['SPX', 'NDX', 'DXY', 'XAU/USD', 'VIX', 'EUR/USD'] as const
const WINDOW_DAYS = 30
const REVALIDATE_S = 21_600 // 6h

async function binanceCloses(symbol: string): Promise<number[]> {
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${WINDOW_DAYS + 1}`,
      { next: { revalidate: REVALIDATE_S } },
    )
    if (!r.ok) return []
    const j = (await r.json()) as Array<[number, string, string, string, string, ...unknown[]]>
    return j.map((k) => parseFloat(k[4])).filter((v) => Number.isFinite(v))
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
    // TD returns most-recent first; reverse to chronological order so
    // returns() pairs with Binance's ascending-time output cleanly.
    return j.values
      .map((v) => (v.close ? parseFloat(v.close) : NaN))
      .filter((n) => Number.isFinite(n))
      .reverse()
  } catch { return [] }
}

function returns(closes: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur  = closes[i]
    if (prev !== undefined && cur !== undefined && prev > 0) {
      out.push(cur / prev - 1)
    }
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
    const av = ax[i]; const bv = bx[i]
    if (av === undefined || bv === undefined) continue
    const da = av - ma, db = bv - mb
    cov += da * db; va += da * da; vb += db * db
  }
  if (va === 0 || vb === 0) return null
  return Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb)))
}

// [a, b, label] — order is irrelevant (Pearson is symmetric).
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['BTC',     'XAU/USD', 'BTC vs Gold'],
  ['BTC',     'NDX',     'BTC vs NASDAQ'],
  ['BTC',     'DXY',     'BTC vs DXY'],
  ['ETH',     'BTC',     'ETH vs BTC'],
  ['SPX',     'NDX',     'S&P 500 vs NASDAQ'],
  ['SPX',     'DXY',     'S&P 500 vs DXY'],
  ['VIX',     'SPX',     'VIX vs S&P 500'],
  ['XAU/USD', 'DXY',     'Gold vs DXY'],
  ['EUR/USD', 'DXY',     'EUR/USD vs DXY'],
]

export async function GET() {
  const [btc, eth, ...td] = await Promise.all([
    binanceCloses('BTCUSDT'),
    binanceCloses('ETHUSDT'),
    ...TD_DAILY.map((s) => tdCloses(s)),
  ])
  const series: Record<string, number[]> = {
    BTC: returns(btc), ETH: returns(eth),
  }
  TD_DAILY.forEach((sym, i) => { series[sym] = returns(td[i] ?? []) })

  const matrix = PAIRS.map(([a, b, pair]) => {
    const ar = series[a] ?? []
    const br = series[b] ?? []
    return {
      pair, a, b,
      correlation: pearson(ar, br),
      n:           Math.min(ar.length, br.length),
    }
  })

  return NextResponse.json(
    { matrix, window_days: WINDOW_DAYS, generated_at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600' } },
  )
}
