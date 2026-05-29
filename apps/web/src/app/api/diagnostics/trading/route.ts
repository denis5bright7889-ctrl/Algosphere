/**
 * GET /api/diagnostics/trading
 *
 * Thin proxy to the engine's /api/v1/diagnostics/trading. Server-only;
 * authenticated. Returns the raw engine payload (no transformation) so
 * the client renders the same shape the engine emits. Cache disabled —
 * this is a live debugging surface.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTradingDiagnostics } from '@/lib/engine-client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const r = await getTradingDiagnostics()
  if (!r.ok) {
    return NextResponse.json(
      { error: 'engine_unreachable', detail: r.error },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json(r.data, { headers: { 'Cache-Control': 'no-store' } })
}
