/**
 * /api/strategies/[id] — single-strategy operations (Refocus R5b).
 *
 * GET    → strategy meta + full version history (latest first).
 * PATCH  → save a new version OR roll back head_version_id to an
 *          earlier version OR update name/description/archived flag.
 * DELETE → soft delete (set is_archived = true) so the row is hidden
 *          from the list but the history survives for audit / undo.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { validateStrategyConfig, type StrategyConfig } from '@/lib/strategies/blocks'


export const dynamic = 'force-dynamic'


// ─── GET ────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [strategyRes, versionsRes] = await Promise.all([
    supabase.from('user_strategies')
      .select('*').eq('id', id).eq('user_id', user.id).single(),
    supabase.from('user_strategy_versions')
      .select('id, version_number, notes, config, created_at')
      .eq('strategy_id', id).eq('user_id', user.id)
      .order('version_number', { ascending: false })
      .limit(50),
  ])

  if (strategyRes.error || !strategyRes.data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    strategy: strategyRes.data,
    versions: versionsRes.data ?? [],
  })
}


// ─── PATCH ──────────────────────────────────────────────────────────

const patchSchema = z.object({
  // EITHER meta updates
  name:        z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  is_archived: z.boolean().optional(),

  // OR a fresh version save
  config:      z.any().optional(),
  notes:       z.string().max(500).optional(),

  // OR a rollback to an existing version
  rollback_to_version_id: z.string().uuid().optional(),
})


export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  // Ownership pre-check — RLS would already enforce, but a single
  // explicit read keeps the rollback flow's foreign-key check cheap.
  const owned = await supabase.from('user_strategies')
    .select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!owned.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Branch 1: meta updates (name / description / archived).
  if (parsed.data.name != null || parsed.data.description != null || parsed.data.is_archived != null) {
    const update: Record<string, unknown> = {}
    if (parsed.data.name        != null) update.name        = parsed.data.name
    if (parsed.data.description != null) update.description = parsed.data.description
    if (parsed.data.is_archived != null) update.is_archived = parsed.data.is_archived
    const { error } = await supabase.from('user_strategies').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Branch 2: rollback to an earlier version. The version must belong
  // to this strategy (FK + ownership check).
  if (parsed.data.rollback_to_version_id) {
    const target = await supabase.from('user_strategy_versions')
      .select('id, strategy_id')
      .eq('id', parsed.data.rollback_to_version_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!target.data || target.data.strategy_id !== id) {
      return NextResponse.json({ error: 'rollback version not found' }, { status: 404 })
    }
    const { error } = await supabase.from('user_strategies')
      .update({ head_version_id: target.data.id })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Branch 3: save a new version.
  let newVersionId: string | null = null
  if (parsed.data.config) {
    const { cleaned, issues } = validateStrategyConfig(parsed.data.config as StrategyConfig)
    if (issues.length > 0) console.warn('strategies PATCH cleaned input:', issues)

    // Next version number = head + 1. We could SELECT MAX(version_number)
    // but that races; the UNIQUE constraint on (strategy_id, version_number)
    // catches collisions.
    const latest = await supabase.from('user_strategy_versions')
      .select('version_number')
      .eq('strategy_id', id)
      .order('version_number', { ascending: false })
      .limit(1).maybeSingle()
    const next = (latest.data?.version_number ?? 0) + 1

    const { data: v, error } = await supabase.from('user_strategy_versions')
      .insert({
        strategy_id:    id,
        user_id:        user.id,
        version_number: next,
        config:         cleaned,
        notes:          parsed.data.notes ?? null,
      })
      .select('id').single()
    if (error || !v) return NextResponse.json({ error: error?.message ?? 'version save failed' }, { status: 500 })
    newVersionId = v.id

    // Move head forward.
    await supabase.from('user_strategies')
      .update({ head_version_id: v.id }).eq('id', id)
  }

  return NextResponse.json({ ok: true, new_version_id: newVersionId })
}


// ─── DELETE (soft) ─────────────────────────────────────────────────

export async function DELETE(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('user_strategies')
    .update({ is_archived: true })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
