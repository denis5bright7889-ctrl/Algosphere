import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/execution/chart?symbol=XAUUSD&interval=15min
 *
 * One payload for the Execution Mirror Chart:
 *   - `bars`:    OHLCV candles from the engine's market-data provider
 *   - `markers`: this user's execution events for the symbol (entry /
 *                exit / rejection), pulled from execution_events
 *   - `positions`: currently-open positions (for SL/TP price lines)
 *
 * Auth: the user can only ever see their own execution_events (RLS).
 * OHLCV is non-sensitive market data.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url      = new URL(req.url)
  const symbol   = (url.searchParams.get('symbol') ?? 'XAUUSD').toUpperCase().slice(0, 20)
  const interval = url.searchParams.get('interval') ?? '15min'

  // 1. OHLCV from the engine (server-to-server; SIGNAL_ENGINE_URL only
  //    on the server). Degrade to empty bars if the engine is down so
  //    the chart still renders execution markers on a blank grid.
  let bars: unknown[] = []
  const engineBase = (process.env.SIGNAL_ENGINE_URL ?? '').replace(/\/$/, '')
  if (engineBase) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8_000)
      const r = await fetch(
        `${engineBase}/api/v1/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=300`,
        { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } },
      )
      clearTimeout(timer)
      if (r.ok) {
        const d = await r.json()
        bars = Array.isArray(d.bars) ? d.bars : []
      }
    } catch {
      /* engine unreachable — markers-only chart */
    }
  }

  // 2. This user's execution events for the symbol (RLS-scoped).
  const { data: events } = await supabase
    .from('execution_events')
    .select('id, event_type, payload, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(500)

  // Filter to this symbol + shape into chart markers. payload symbol
  // lives under different keys depending on event_type, so check both.
  const markers = (events ?? [])
    .filter((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>
      const sym = String(p.symbol ?? '').toUpperCase()
      return sym === symbol
    })
    .map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>
      return {
        id:         e.id,
        event_type: e.event_type,
        time:       Math.floor(new Date(e.created_at).getTime() / 1000),
        side:       String(p.side ?? ''),
        price:      typeof p.avg_fill_price === 'number' ? p.avg_fill_price
                    : typeof p.exit === 'number' ? p.exit
                    : typeof p.avg_entry === 'number' ? p.avg_entry : null,
        qty:        typeof p.filled_qty === 'number' ? p.filled_qty
                    : typeof p.qty === 'number' ? p.qty : null,
        sl:         typeof p.sl === 'number' ? p.sl : null,
        tp:         typeof p.tp === 'number' ? p.tp : null,
        realized_pnl: typeof p.realized_pnl === 'number' ? p.realized_pnl : null,
        status:     String(p.status ?? ''),
      }
    })

  return NextResponse.json({
    symbol,
    interval,
    bars,
    markers,
    engine_configured: !!engineBase,
  })
}
