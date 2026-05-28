/**
 * GET /api/intelligence/grid — the Analyze-Mode intelligence grid payload.
 *
 * Auth-gated. Returns the consolidated verdict + one module per engine
 * (real Decision-Brain signals). The grid client polls this for live
 * refresh. One gather per request — the engines run once.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeIntelligenceGrid } from '@/lib/intelligence/grid'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await composeIntelligenceGrid())
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Grid compose failed' },
      { status: 502 },
    )
  }
}
