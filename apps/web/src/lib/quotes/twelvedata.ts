/**
 * Twelve Data REST quote client — server-only.
 *
 * Free tier is rate-limited (8 req/min, 800/day on the published
 * "Basic" plan). Two practices keep us inside that:
 *   1. Batch via comma-joined symbols on /quote so any number of
 *      symbols counts as one request.
 *   2. `next: { revalidate: 15 }` so identical bursts of clicks are
 *      served from the Next fetch cache for 15s.
 *
 * Honest failure: returns an EMPTY Map on any upstream error — the
 * caller decides what to render for missing symbols (we never invent
 * a number).
 */

import type { Quote } from './types'

const BASE = 'https://api.twelvedata.com'
const TIMEOUT_MS = 6000

export function isTwelveDataConfigured(): boolean {
  return typeof process.env.TWELVE_DATA_API_KEY === 'string'
      && process.env.TWELVE_DATA_API_KEY.length > 4
}

interface TdQuoteRow {
  symbol?:         string
  close?:          string | number
  previous_close?: string | number
  change?:         string | number
  percent_change?: string | number
  timestamp?:      number
  // Error rows come back keyed by symbol with this shape:
  status?:         string
  code?:           number
  message?:        string
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Fetch quotes for the given Twelve-Data-shaped symbols
 * (e.g. 'EUR/USD', 'XAU/USD', 'NDX', 'AAPL'). Returns a Map keyed by
 * the SAME provider-symbol string the caller passed in.
 */
export async function getQuotes(providerSymbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>()
  if (!isTwelveDataConfigured() || providerSymbols.length === 0) return out

  // Twelve Data /quote accepts up to ~120 symbols comma-joined.
  // Chunk defensively at 60.
  const chunks: string[][] = []
  for (let i = 0; i < providerSymbols.length; i += 60) {
    chunks.push(providerSymbols.slice(i, i + 60))
  }

  await Promise.all(chunks.map(async (chunk) => {
    const url = new URL(`${BASE}/quote`)
    url.searchParams.set('symbol', chunk.join(','))
    url.searchParams.set('apikey', process.env.TWELVE_DATA_API_KEY!)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url.toString(), {
        signal: ctrl.signal,
        // 15s in-process cache — free-tier conservation. Real-time
        // is governed by the provider's own update cadence anyway.
        next: { revalidate: 15 },
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return
      const json = await res.json().catch(() => null) as Record<string, TdQuoteRow> | TdQuoteRow | null
      if (!json) return

      // Single-symbol calls return the row directly; multi-symbol
      // calls return a keyed object. Normalise both into [key, row].
      const entries: [string, TdQuoteRow][] =
        chunk.length === 1
          ? [[chunk[0]!, json as TdQuoteRow]]
          : Object.entries(json as Record<string, TdQuoteRow>)

      const now = new Date().toISOString()
      for (const [key, row] of entries) {
        if (!row || row.status === 'error') continue
        const price = num(row.close)
        const pct   = num(row.percent_change)
        if (price == null || pct == null) continue
        out.set(key, {
          symbol:     key,
          price,
          changePct:  pct,
          source:     'twelvedata',
          fetchedAt:  row.timestamp ? new Date(row.timestamp * 1000).toISOString() : now,
        })
      }
    } catch {
      // Honest empty — no fabricated quote on failure.
    } finally {
      clearTimeout(timer)
    }
  }))

  return out
}
