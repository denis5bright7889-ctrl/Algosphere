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

const VALID_ASSET_CLASS = new Set([
  'forex', 'gold', 'indices', 'stocks', 'commodities', 'futures', 'crypto', 'etf',
])
const VALID_PROVIDER = new Set(['twelvedata', 'finnhub', 'crypto-stream'])

/** Canonical symbol form — slashes stripped, uppercased. Keeps
 *  universe-pinned (EURUSD) and catalog-pinned (EUR/USD) symbols on
 *  the same primary key so the same pair is never two rows. */
function canonicalize(sym: string): string {
  return sym.replace(/[\s/]/g, '').toUpperCase()
}

/** Postgres "undefined_table" / "undefined_column" — surfaces when
 *  a migration hasn't been pushed. Honest 503 beats a generic 500. */
function isUndefinedSchema(err: { code?: string } | null | undefined): boolean {
  return err?.code === '42P01' || err?.code === '42703'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('watchlist_items')
    .select('symbol, asset_class, added_at, provider, provider_symbol, label')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false })

  if (error) {
    if (isUndefinedSchema(error)) {
      return NextResponse.json({
        error: 'Watchlist schema out of date — run `supabase db push` (migrations 20240101000024 + 20240101000025).',
        code: 'migration_pending',
      }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}

const postSchema = z.object({
  symbol:          z.string().min(1).max(40),
  // Catalog-pin path: when these are present we bypass the universe
  // gate and trust the caller's metadata (the caller is our own
  // /api/market/catalog/[class] proxy, which already validated the
  // class via an allowlist).
  asset_class:     z.string().max(20).optional(),
  provider:        z.string().max(20).optional(),
  provider_symbol: z.string().max(40).optional(),
  label:           z.string().max(120).optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  let row: {
    user_id:          string
    symbol:           string
    asset_class:      string
    provider:         string | null
    provider_symbol:  string | null
    label:            string | null
  }

  if (parsed.data.provider) {
    // ── Catalog-pin path ────────────────────────────────────────────
    if (!VALID_PROVIDER.has(parsed.data.provider)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 422 })
    }
    const cls = (parsed.data.asset_class ?? '').toLowerCase()
    if (!VALID_ASSET_CLASS.has(cls)) {
      return NextResponse.json({ error: 'Invalid asset_class' }, { status: 422 })
    }
    const canon = canonicalize(parsed.data.symbol)
    if (!canon) {
      return NextResponse.json({ error: 'Empty symbol after canonicalisation' }, { status: 422 })
    }
    row = {
      user_id:         user.id,
      symbol:          canon,
      asset_class:     cls,
      provider:        parsed.data.provider,
      provider_symbol: parsed.data.provider_symbol ?? parsed.data.symbol,
      label:           parsed.data.label ?? canon,
    }
  } else {
    // ── Universe-pin path (existing behaviour) ──────────────────────
    const inst = INSTRUMENTS.get(parsed.data.symbol)
    if (!inst) {
      return NextResponse.json({ error: 'Symbol not in market universe' }, { status: 422 })
    }
    row = {
      user_id:         user.id,
      symbol:          inst.symbol,
      asset_class:     inst.assetClass,
      provider:        null,
      provider_symbol: null,
      label:           null,
    }
  }

  const { data, error } = await supabase
    .from('watchlist_items')
    .upsert(row, { onConflict: 'user_id,symbol' })
    .select('symbol, asset_class, added_at, provider, provider_symbol, label')
    .single()

  if (error) {
    if (isUndefinedSchema(error)) {
      return NextResponse.json({
        error: 'Watchlist schema out of date — run `supabase db push`',
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
    if (isUndefinedSchema(error)) {
      return NextResponse.json({
        error: 'Watchlist schema out of date — run `supabase db push`',
        code: 'migration_pending',
      }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to remove' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
