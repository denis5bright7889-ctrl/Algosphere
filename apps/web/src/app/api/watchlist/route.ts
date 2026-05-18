import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { MARKET_UNIVERSE } from '@/lib/market-universe'

export const dynamic = 'force-dynamic'

// Build a flat symbol → instrument map once for O(1) validation.
// New imports invalidate the module so this is always in sync with
// the catalog without per-request rebuild cost.
const INSTRUMENTS = new Map(
  MARKET_UNIVERSE.flatMap((c) =>
    c.instruments.map((i) => [i.symbol, i] as const),
  ),
)

/** Postgres "undefined_table" error code — surfaces when the
 *  migration hasn't been pushed yet. Lets us return an honest 503
 *  rather than a generic 500. */
function isUndefinedTable(err: { code?: string } | null | undefined): boolean {
  return err?.code === '42P01'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('watchlist_items')
    .select('symbol, asset_class, added_at')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false })

  if (error) {
    if (isUndefinedTable(error)) {
      return NextResponse.json({
        error: 'Watchlist table missing — run `supabase db push` to apply migration 20240101000024_watchlist.sql',
        code: 'migration_pending',
      }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}

const postSchema = z.object({ symbol: z.string().min(1).max(40) })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }
  // Universe gate — refuses any symbol not in the canonical catalog.
  // Catalog is the single source of truth; ad-hoc symbols can't enter.
  const inst = INSTRUMENTS.get(parsed.data.symbol)
  if (!inst) {
    return NextResponse.json({ error: 'Symbol not in market universe' }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('watchlist_items')
    .upsert(
      { user_id: user.id, symbol: inst.symbol, asset_class: inst.assetClass },
      { onConflict: 'user_id,symbol' },
    )
    .select('symbol, asset_class, added_at')
    .single()

  if (error) {
    if (isUndefinedTable(error)) {
      return NextResponse.json({
        error: 'Watchlist table missing — run `supabase db push`',
        code: 'migration_pending',
      }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to add' }, { status: 500 })
  }

  return NextResponse.json({ item: data }, { status: 201 })
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const symbol = new URL(req.url).searchParams.get('symbol')
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 422 })

  const { error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('user_id', user.id)
    .eq('symbol', symbol)

  if (error) {
    if (isUndefinedTable(error)) {
      return NextResponse.json({
        error: 'Watchlist table missing — run `supabase db push`',
        code: 'migration_pending',
      }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to remove' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
