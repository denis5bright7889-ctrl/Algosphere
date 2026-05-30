/**
 * GET /api/backtest/ohlcv?symbol=…&interval=…&outputsize=…
 *
 * Auth-gated proxy to the signal-engine's /api/v1/ohlcv. The engine
 * URL + key are server-only env vars, never exposed to the client.
 *
 * Returns the engine response verbatim — including the soft empty
 * state when the engine has no provider configured (the UI shows
 * "no historical data available, run synthetic instead").
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOhlcv } from '@/lib/engine-client'

export const dynamic = 'force-dynamic'

const ALLOWED_INTERVALS = new Set([
  '1min', '5min', '15min', '30min', '45min',
  '1h', '2h', '4h', '1day', '1week',
])

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const symbol     = (searchParams.get('symbol') ?? '').trim().toUpperCase()
  const interval   = searchParams.get('interval') ?? '1h'
  const outputsize = Math.min(500, Math.max(50, Number(searchParams.get('outputsize') ?? 500)))

  if (!symbol || symbol.length < 2 || symbol.length > 20) {
    return NextResponse.json({ error: 'invalid symbol' }, { status: 422 })
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: `interval must be one of ${[...ALLOWED_INTERVALS].join(',')}` }, { status: 422 })
  }

  const r = await getOhlcv(symbol, interval, outputsize)
  if (!r.ok) {
    return NextResponse.json(
      { error: 'engine_unreachable', detail: r.error },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json(r.data, {
    headers: {
      // Server-side bars are stable for short windows; cache lightly so
      // a user iterating on cost-model params doesn't hammer the engine.
      'Cache-Control': 'private, max-age=30',
    },
  })
}
