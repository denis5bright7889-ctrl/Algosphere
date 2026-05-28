import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCatalog, type CatalogClass } from '@/lib/quotes/twelvedata-catalog'

export const dynamic = 'force-dynamic'

const ALLOWED: ReadonlySet<CatalogClass> = new Set([
  'forex', 'commodities', 'stocks', 'indices', 'etf', 'crypto',
])

/**
 * GET /api/market/catalog/[class]
 *
 * Returns the full Twelve Data reference catalog for one asset class.
 * Auth-gated (signed-in users only) so the api key never leaves the
 * server. Cached for 24h via Next fetch cache — reference data
 * changes rarely. Optional ?search=... is a server-side substring
 * filter on symbol|label|context (case-insensitive) so we don't
 * ship thousands of rows when the user types.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ class: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { class: rawClass } = await ctx.params
  const cls = rawClass.toLowerCase() as CatalogClass
  if (!ALLOWED.has(cls)) {
    return NextResponse.json(
      { error: `unknown class '${rawClass}'`, allowed: [...ALLOWED] },
      { status: 400 },
    )
  }

  const url    = new URL(req.url)
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()
  const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '500', 10) || 500, 1), 2000)

  const result = await getCatalog(cls)

  let rows = result.rows
  if (search) {
    rows = rows.filter((r) =>
      r.symbol.toLowerCase().includes(search)
      || r.label.toLowerCase().includes(search)
      || (r.context?.toLowerCase().includes(search) ?? false),
    )
  }
  const sliced = rows.slice(0, limit)

  return NextResponse.json({
    ok:        result.ok,
    class:     result.class,
    total:     result.total,
    returned:  sliced.length,
    truncated: rows.length > sliced.length,
    rows:      sliced,
    error:     result.error,
  })
}
