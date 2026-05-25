/**
 * /api/intelligence/conviction — institutional multi-layer agreement.
 *
 * Composes the Conviction view (see `lib/conviction.ts`) for one or
 * many symbols. Per the platform philosophy, the response exposes
 * STATES + BIAS + STRENGTH — never raw formulas or thresholds.
 *
 *   GET /api/intelligence/conviction?symbol=BTCUSDT
 *     -> single ConvictionView
 *
 *   GET /api/intelligence/conviction?symbols=BTCUSDT,ETHUSDT,EURUSD
 *     -> { views: ConvictionView[] }
 *
 * Auth: requires a logged-in user (consistent with the rest of /api/*).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeConviction } from '@/lib/conviction'

export const dynamic = 'force-dynamic'

function parseSymbols(sp: URLSearchParams): string[] {
  const single = sp.get('symbol')
  if (single) return [single.toUpperCase()]
  const list = (sp.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  return list.slice(0, 12)               // sanity cap — protects against spray requests
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
      const view = await composeConviction(symbols[0]!)
      return NextResponse.json(view)
    }
    const views = await Promise.all(symbols.map((s) => composeConviction(s)))
    return NextResponse.json({ views, fetched_at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Conviction compose failed' },
      { status: 502 },
    )
  }
}
