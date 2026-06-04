/**
 * /api/strategies — user-authored strategy CRUD (Refocus R5b).
 *
 * GET  → list this user's non-archived strategies + head version each.
 * POST → create a new strategy. Accepts either { template_key } to clone
 *        a built-in template OR { config } to start from a blank/custom
 *        config. Always creates version 1 and points head_version_id at it.
 *
 * RLS protects against cross-user reads/writes; we still re-check
 * ownership server-side on the create flow so the head_version_id
 * never accidentally points at a foreign version.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { trackServerAsync } from '@/lib/tracking/server'
import {
  validateStrategyConfig, blankConfig,
  type StrategyConfig,
} from '@/lib/strategies/blocks'
import { TEMPLATE_BY_KEY, type TemplateKey } from '@/lib/strategies/templates'


export const dynamic = 'force-dynamic'


// ─── GET ────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_strategies')
    .select(`
      id, name, description, template_key, is_archived,
      head_version_id, created_at, updated_at,
      head:user_strategy_versions!user_strategies_head_fk (
        id, version_number, notes, config, created_at
      )
    `)
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data })
}


// ─── POST ───────────────────────────────────────────────────────────

const createSchema = z.object({
  name:         z.string().min(1).max(80),
  description:  z.string().max(500).optional(),
  template_key: z.string().optional(),
  config:       z.any().optional(),
  notes:        z.string().max(500).optional(),
})


export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  // Resolve the initial config — template wins if both supplied.
  let initial: StrategyConfig
  if (parsed.data.template_key) {
    const t = TEMPLATE_BY_KEY[parsed.data.template_key as TemplateKey]
    if (!t) return NextResponse.json({ error: 'unknown template_key' }, { status: 422 })
    initial = JSON.parse(JSON.stringify(t.config)) as StrategyConfig
  } else if (parsed.data.config) {
    initial = parsed.data.config as StrategyConfig
  } else {
    initial = blankConfig()
  }

  const { cleaned, issues } = validateStrategyConfig(initial)
  if (issues.length > 0) {
    // Cleaning is permissive — log + continue. Non-fatal.
    console.warn('strategies POST cleaned input:', issues)
  }

  // Two writes in sequence: create the strategy row, create version 1,
  // then point head_version_id at it. RLS scopes everything to the
  // caller. No transaction needed because the head pointer is nullable
  // and the editor reads versions directly if missing.
  const { data: strategy, error: sErr } = await supabase
    .from('user_strategies')
    .insert({
      user_id:       user.id,
      name:          parsed.data.name,
      description:   parsed.data.description ?? null,
      template_key:  parsed.data.template_key ?? null,
    })
    .select('id')
    .single()

  if (sErr || !strategy) {
    return NextResponse.json({ error: sErr?.message ?? 'create failed' }, { status: 500 })
  }

  const { data: version, error: vErr } = await supabase
    .from('user_strategy_versions')
    .insert({
      strategy_id:    strategy.id,
      user_id:        user.id,
      version_number: 1,
      config:         cleaned,
      notes:          parsed.data.notes ?? 'Initial save',
    })
    .select('id')
    .single()

  if (vErr || !version) {
    return NextResponse.json({ error: vErr?.message ?? 'version create failed' }, { status: 500 })
  }

  await supabase
    .from('user_strategies')
    .update({ head_version_id: version.id })
    .eq('id', strategy.id)

  // Funnel: strategy_created — fire-and-forget. Distinct user_id
  // collapses repeats at the dashboard layer.
  trackServerAsync({
    event:       'strategy_created',
    userId:      user.id,
    source_kind: 'app',
    payload:     {
      strategy_id:  strategy.id,
      template_key: parsed.data.template_key ?? null,
    },
  })

  return NextResponse.json(
    { id: strategy.id, head_version_id: version.id, issues },
    { status: 201 },
  )
}
