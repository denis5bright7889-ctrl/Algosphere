/**
 * GET /api/market/intel/[symbol] — per-instrument intelligence for the
 * chart modal's AI panel. Latest regime read + tier-gated latest signal,
 * translated to the institutional state language. Auth-gated; the signal
 * edge is gated inside the composer by the viewer's tier.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeSymbolIntel } from '@/lib/chart-intel'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { symbol } = await params
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  try {
    return NextResponse.json(await composeSymbolIntel(decodeURIComponent(symbol)))
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Intel failed' },
      { status: 502 },
    )
  }
}
