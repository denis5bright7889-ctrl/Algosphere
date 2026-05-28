/**
 * /api/intelligence/positioning — leverage / crowding / liquidation risk.
 *
 * Returns the full PositioningBoard (per-asset views + universe summary)
 * sourced from Bybit V5 public REST. Crypto-only — extends naturally to
 * other asset classes when their funding/positioning data is wired.
 *
 *   GET /api/intelligence/positioning
 *   GET /api/intelligence/positioning?symbols=BTCUSDT,ETHUSDT,SOLUSDT
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composePositioningBoard } from '@/lib/positioning-engine'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const raw = (sp.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  const symbols = raw.length ? raw.slice(0, 20) : undefined
  try {
    const board = await composePositioningBoard(symbols)
    return NextResponse.json(board)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Positioning compose failed' },
      { status: 502 },
    )
  }
}
