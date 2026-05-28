/**
 * /api/intelligence/momentum — institutional momentum phase view.
 *
 * Returns the MomentumView (see lib/momentum-engine.ts) for one or many
 * symbols. Exposes PHASE, DIRECTION, QUALITY, SUSTAINABILITY — never the
 * underlying DER/autocorr/ATR values used to derive them.
 *
 *   GET /api/intelligence/momentum?symbol=BTCUSDT
 *     -> single MomentumView
 *
 *   GET /api/intelligence/momentum?symbols=BTCUSDT,ETHUSDT,EURUSD
 *     -> { views: MomentumView[] }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeMomentumView } from '@/lib/momentum-engine'

export const dynamic = 'force-dynamic'

function parseSymbols(sp: URLSearchParams): string[] {
  const single = sp.get('symbol')
  if (single) return [single.toUpperCase()]
  const list = (sp.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  return list.slice(0, 16)
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const symbols = parseSymbols(sp)
  if (symbols.length === 0) {
    return NextResponse.json({ error: 'Provide symbol or symbols query param' }, { status: 400 })
  }

  try {
    if (symbols.length === 1) {
      const view = await composeMomentumView(symbols[0]!)
      return NextResponse.json(view)
    }
    const views = await Promise.all(symbols.map((s) => composeMomentumView(s)))
    return NextResponse.json({ views, fetched_at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Momentum compose failed' },
      { status: 502 },
    )
  }
}
