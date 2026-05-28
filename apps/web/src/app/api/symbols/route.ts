/**
 * GET /api/symbols — the institutional symbol registry, JSON.
 *
 * Static catalog metadata composed from MARKET_UNIVERSE + curated
 * institutional overrides (sector, tiers, scan priority, tags, provider
 * routes, risk profile). Auth-gated. Heavily cached (1h s-maxage) since
 * the catalog is build-time data.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { symbolRegistry } from '@/lib/symbol-registry'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const registry = symbolRegistry()
  return NextResponse.json(
    { count: registry.length, registry, generated_at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  )
}
