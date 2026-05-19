/**
 * Finnhub REST quote client — server-only.
 *
 * Free tier: 60 calls/minute. /quote is per-symbol (no batch), so we
 * fan out with bounded concurrency. Next fetch cache holds responses
 * for 15s. US equities are the strongest free-tier surface; other
 * classes are better served by Twelve Data.
 *
 * Honest failure: missing symbols are simply absent from the Map.
 */

import type { Quote } from './types'

const BASE = 'https://finnhub.io/api/v1'
const TIMEOUT_MS = 5000
const MAX_CONCURRENT = 6

export function isFinnhubConfigured(): boolean {
  return typeof process.env.FINNHUB_API_KEY === 'string'
      && process.env.FINNHUB_API_KEY.length > 4
}

interface FhQuote {
  c?: number  // current
  d?: number  // change (abs)
  dp?: number // percent change
  pc?: number // prev close
  t?: number  // unix s
}

async function fetchOne(symbol: string): Promise<Quote | null> {
  const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY!}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      next: { revalidate: 15 },
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const q = (await res.json().catch(() => null)) as FhQuote | null
    if (!q || typeof q.c !== 'number' || q.c <= 0) return null
    // Finnhub returns dp as percent number (e.g. 0.9 = +0.9%, not 0.009).
    const pct = typeof q.dp === 'number' ? q.dp : (q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0)
    return {
      symbol,
      price:     q.c,
      changePct: pct,
      source:    'finnhub',
      fetchedAt: q.t ? new Date(q.t * 1000).toISOString() : new Date().toISOString(),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch quotes for the given Finnhub-shaped symbols (e.g. 'AAPL').
 * Bounded concurrency keeps us well inside 60 req/min.
 */
export async function getQuotes(providerSymbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>()
  if (!isFinnhubConfigured() || providerSymbols.length === 0) return out

  // Pool of MAX_CONCURRENT workers, classic worker-pool pattern.
  const queue = [...providerSymbols]
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift()
      if (s == null) break
      const q = await fetchOne(s)
      if (q) out.set(s, q)
    }
  })
  await Promise.all(workers)
  return out
}
