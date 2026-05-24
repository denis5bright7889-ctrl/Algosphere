/**
 * AlgoSphere Quant — Public Signals API (VIP / institutional)
 *
 *   GET /api/v1/signals?limit=50&pair=XAUUSD
 *   Authorization: Bearer aq_live_…
 *
 * Auth, tier gate, rate limit and metering are all handled by
 * authenticateApiKey(). This handler only shapes the response.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { authenticateApiKey, isApiError } from '@/lib/api-auth'
import { toPublicSignals } from '@/lib/signal-abstraction'

export async function GET(request: Request) {
  const ctx = await authenticateApiKey(request, 'signals:read')
  if (isApiError(ctx)) return ctx

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  const pair  = searchParams.get('pair')?.toUpperCase()

  const db = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // engine_version dropped — model versioning is an engine internal and
  // must not leak. strategy_id / quality_score are read only to derive
  // the alias and band inside toPublicSignal(); neither is serialized.
  let q = db
    .from('signals')
    .select(
      'id,pair,direction,entry_price,stop_loss,take_profit_1,take_profit_2,' +
      'take_profit_3,risk_reward,confidence_score,quality_score,regime,session,' +
      'strategy_id,tier_required,lifecycle_state,status,result,pips_gained,' +
      'published_at,invalidated_at',
    )
    .order('published_at', { ascending: false })
    .limit(limit)

  if (pair) q = q.eq('pair', pair)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  // Strategy-opacity boundary: sanitize before the response leaves the server.
  const signals = toPublicSignals(data)

  return NextResponse.json(
    {
      data: signals,
      count: signals.length,
      meta: { tier: ctx.tier, limit, pair: pair ?? null },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-AlgoSphere-Tier': ctx.tier,
      },
    },
  )
}
