/**
 * GET /api/market/overview — crypto market breadth (Phase 7/8).
 *
 * Dominance (BTC/ETH/alt), total market cap + 24h direction, top movers,
 * and trending coins. Sourced from CoinGecko, heavily cached at the fetch
 * layer. Auth-gated like the rest of /api/*.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeMarketOverview } from '@/lib/coingecko'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await composeMarketOverview())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Overview failed' }, { status: 502 })
  }
}
