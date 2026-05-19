/**
 * GET /api/quotes?symbols=A,B,C
 *
 * Server-side market-data quote endpoint. Auth-gated so anonymous
 * traffic can't drain our Twelve Data / Finnhub free-tier quotas.
 * Provider API keys stay server-only.
 *
 * Returns the symbols that have a live quote AND a meta block stating
 * which providers are actually configured — the client uses meta to
 * render an honest "Feed not connected" for symbols absent from
 * `quotes` (vs distinguishing rate-limit-skipped, etc.).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUniverseQuotes, providerStatus } from '@/lib/quotes'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = new URL(req.url).searchParams.get('symbols') ?? ''
  // Defensive: cap at 60 symbols/request to keep latency + rate-limit
  // behaviour predictable. Watchlists are well under this in practice.
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 60)

  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [], meta: { providers: providerStatus(), fetched_at: new Date().toISOString() } })
  }

  const map = await getUniverseQuotes(symbols)
  return NextResponse.json({
    quotes: [...map.values()],
    meta:   {
      providers:  providerStatus(),
      requested:  symbols.length,
      served:     map.size,
      fetched_at: new Date().toISOString(),
    },
  })
}
