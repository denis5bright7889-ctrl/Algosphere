import { NextResponse } from 'next/server'
import { narrativeRoute } from '@/services/onchain/handler'

export const dynamic = 'force-dynamic'

const SURFACES = [
  'smart-money', 'whale-flows', 'exchange-flows', 'stablecoin-liquidity',
  'token-momentum', 'market-rotation', 'heatmap',
] as const

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ surface: string }> },
) {
  const { surface } = await ctx.params
  if (!(SURFACES as readonly string[]).includes(surface)) {
    return NextResponse.json({ error: 'Unknown surface' }, { status: 404 })
  }
  return narrativeRoute(surface as typeof SURFACES[number])()
}
