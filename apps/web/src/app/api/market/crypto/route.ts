import { NextResponse } from 'next/server'
import { REST_URL, normalizeRest } from '@/lib/binance'

/**
 * Real crypto snapshot from Binance public REST. Seeds first paint
 * and is the fallback when the browser WebSocket can't connect.
 * Resilient: 4s timeout, honest 502 on failure (never a fake price).
 * Edge-cached ~5s so a burst of clients doesn't hammer the exchange.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(REST_URL, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`Binance ${res.status}`)
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows)) throw new Error('Unexpected payload')

    return NextResponse.json(
      {
        data: normalizeRest(rows),
        source: 'binance',
        fetched_at: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 's-maxage=5, stale-while-revalidate=15',
        },
      },
    )
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upstream unavailable', source: 'binance' },
      { status: 502 },
    )
  } finally {
    clearTimeout(timer)
  }
}
