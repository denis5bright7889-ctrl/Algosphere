/**
 * /api/intelligence/liquidity — institutional liquidity intelligence.
 *
 * Returns the LiquidityBoard (see lib/liquidity-engine.ts) — per-asset
 * execution condition, imbalance, walls, voids, sweep + manipulation
 * risk, quality score. Sourced from Coinbase public L2 order books.
 *
 *   GET /api/intelligence/liquidity
 *   GET /api/intelligence/liquidity?symbols=BTCUSDT,ETHUSDT
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeLiquidityBoard } from '@/lib/liquidity-engine'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const raw = (sp.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  const symbols = raw.length ? raw.slice(0, 12) : undefined
  try {
    const board = await composeLiquidityBoard(symbols)
    return NextResponse.json(board)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Liquidity compose failed' },
      { status: 502 },
    )
  }
}
