import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { slugify, validateStrategyDraft } from '@/lib/strategies'

// ─── GET /api/social/strategies ─────────────────────────────
// List active strategies (public) OR own drafts (authenticated)
export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope') ?? 'public'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  let query = supabase
    .from('published_strategies')
    .select('*, profiles!published_strategies_creator_id_fkey(public_handle, bio)')
    .order('subscribers_count', { ascending: false })
    .limit(limit)

  if (scope === 'mine') {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    query = query.eq('creator_id', user.id)
  } else {
    query = query.eq('status', 'active')
  }

  const { data, error } = await query
  if (error) {
    console.error('strategies list error:', error)
    return NextResponse.json({ error: 'Failed to load strategies' }, { status: 500 })
  }
  return NextResponse.json({ strategies: data ?? [] })
}

// ─── POST /api/social/strategies ────────────────────────────
// Create a new strategy (draft)
const createSchema = z.object({
  name:           z.string().min(3).max(80),
  tagline:        z.string().max(120).optional(),
  description:    z.string().max(2000).optional(),
  asset_classes:  z.array(z.string()).min(1),
  pairs:          z.array(z.string()).optional(),
  timeframes:     z.array(z.string()).optional(),
  trading_style:  z.enum(['scalping','day','swing','position']).optional(),
  risk_approach:  z.enum(['conservative','moderate','aggressive']).optional(),
  is_free:        z.boolean().default(false),
  price_monthly:  z.number().positive().optional(),
  price_annual:   z.number().positive().optional(),
  price_lifetime: z.number().positive().optional(),
  copy_enabled:   z.boolean().default(false),
  copy_mode:      z.enum(['signal_only','semi_auto','full_auto']).default('signal_only'),
  profit_share_pct: z.number().min(0).max(50).default(20),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const draft = parsed.data
  const err   = validateStrategyDraft(draft)
  if (err) return NextResponse.json({ error: err }, { status: 422 })

  // Generate unique slug
  let slug    = slugify(draft.name)
  let attempt = 0
  while (attempt < 5) {
    const { data: exists } = await supabase
      .from('published_strategies')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!exists) break
    attempt += 1
    slug = `${slugify(draft.name)}-${Math.random().toString(36).slice(2, 6)}`
  }

  const { data, error } = await supabase
    .from('published_strategies')
    .insert({
      ...draft,
      creator_id: user.id,
      slug,
      status:     'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('strategy create error:', error)
    return NextResponse.json({ error: 'Failed to create strategy' }, { status: 500 })
  }

  return NextResponse.json({ strategy: data }, { status: 201 })
}
