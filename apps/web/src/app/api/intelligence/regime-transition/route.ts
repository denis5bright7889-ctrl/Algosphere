/**
 * /api/intelligence/regime-transition — what the market IS BECOMING.
 *
 * Returns the RegimeTransitionView (see lib/regime-transition.ts) for
 * one or many symbols. Pairs with the existing regime classification
 * (what the market IS) to give a complete read.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeRegimeTransition } from '@/lib/regime-transition'

export const dynamic = 'force-dynamic'

function parseSymbols(sp: URLSearchParams): string[] {
  const single = sp.get('symbol')
  if (single) return [single.toUpperCase()]
  const list = (sp.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  return list.slice(0, 24)
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
      return NextResponse.json(await composeRegimeTransition(symbols[0]!))
    }
    const views = await Promise.all(symbols.map((s) => composeRegimeTransition(s)))
    return NextResponse.json({ views, fetched_at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Regime transition compose failed' },
      { status: 502 },
    )
  }
}
