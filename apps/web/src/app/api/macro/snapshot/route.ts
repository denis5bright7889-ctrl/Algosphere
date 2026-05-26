/**
 * /api/macro/snapshot — institutional macro intelligence snapshot.
 *
 * Returns the 4 macro indicators the market-intelligence narrative
 * leans on (inflation, real GDP, 10Y treasury yield, fed funds rate)
 * in a single response. Powered by Alpha Vantage's free-tier macro
 * endpoints, cached for 6 hours at the fetch layer (see lib/alphavantage.ts).
 *
 * Auth: requires a logged-in user (consistent with the rest of /api/*).
 * Configuration: when ALPHA_VANTAGE_API_KEY is unset the route responds
 * 200 with `available: false` so the UI can fall back to a "Macro layer
 * not configured" message without erroring.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMacroSnapshot, isAlphaVantageConfigured, AlphaVantageError } from '@/lib/alphavantage'

export const dynamic  = 'force-dynamic'
export const revalidate = 0           // route itself is dynamic; fetch layer caches AV calls

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAlphaVantageConfigured()) {
    return NextResponse.json({
      available:  false,
      reason:     'ALPHA_VANTAGE_API_KEY not configured',
      indicators: [],
    })
  }

  try {
    const snap = await getMacroSnapshot()
    return NextResponse.json({
      available: true,
      ...snap,
    })
  } catch (e) {
    const msg = e instanceof AlphaVantageError ? e.message : 'Macro snapshot failed'
    return NextResponse.json(
      { available: false, reason: msg, indicators: [] },
      { status: 502 },
    )
  }
}
