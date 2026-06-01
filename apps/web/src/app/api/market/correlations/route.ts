/**
 * GET /api/market/correlations — V3 Phase 4 (rolling-Pearson engine).
 *
 * Delegates to lib/correlation-engine. The route's job is just auth +
 * cache headers; all data sourcing, Pearson math, classification and
 * risk interpretation live in the engine module so the decision-brain
 * composer can reuse the same logic for the consolidated grid.
 *
 * Cache: 60-min s-maxage aligns with V3 spec Phase 2 (correlations
 * TTL). Stale-while-revalidate keeps the UI responsive when the panel
 * is being rebuilt in the background.
 */
import { NextResponse } from 'next/server'
import { composeCorrelationView } from '@/lib/correlation-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const view = await composeCorrelationView()
  return NextResponse.json(view, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600' },
  })
}
