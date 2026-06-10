/**
 * POST /api/shadow/ingest
 *
 * Public-ish ingest. The caller must be authenticated; the engine
 * forces user_id from the session (the body's user_id is ignored
 * to prevent cross-user spoofing).
 *
 * Body:
 *   {
 *     symbol:     "BTCUSDT",
 *     direction:  "buy" | "sell",
 *     entry:      30000.5,
 *     sl:         29500   (optional),
 *     tp:         31000   (optional),
 *     lot:        0.01,
 *     broker:     "binance" | "mt5" | "bybit" | "okx" | "coinbase" |
 *                  "oanda" | "default"  (any string accepted; unknown
 *                                         falls back to default profile),
 *     strategy_id:    "<uuid>" (optional),
 *     signal_id:      "<uuid>" (optional),
 *     copy_trade_id:  "<uuid>" (optional)
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ingestSignal } from '@/lib/intelligence/shadow-execution-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const schema = z.object({
  symbol:        z.string().min(1).max(30),
  direction:     z.enum(['buy', 'sell']),
  entry:         z.number().positive(),
  sl:            z.number().positive().nullable().optional(),
  tp:            z.number().positive().nullable().optional(),
  lot:           z.number().positive(),
  broker:        z.string().min(1).max(40),
  strategy_id:   z.string().uuid().nullable().optional(),
  signal_id:     z.string().uuid().nullable().optional(),
  copy_trade_id: z.string().uuid().nullable().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.format() },
      { status: 422 },
    )
  }

  const result = await ingestSignal({
    user_id:       user.id,
    symbol:        parsed.data.symbol,
    direction:     parsed.data.direction,
    entry:         parsed.data.entry,
    sl:            parsed.data.sl ?? null,
    tp:            parsed.data.tp ?? null,
    lot:           parsed.data.lot,
    broker:        parsed.data.broker,
    strategy_id:   parsed.data.strategy_id ?? null,
    signal_id:     parsed.data.signal_id ?? null,
    copy_trade_id: parsed.data.copy_trade_id ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Ingest failed' }, { status: 400 })
  }

  return NextResponse.json(result)
}
