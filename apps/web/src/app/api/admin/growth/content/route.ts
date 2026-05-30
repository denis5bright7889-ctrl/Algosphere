/**
 * /api/admin/growth/content — Growth Engine V1 Phase 1.
 *
 * GET   → list content_items (admin-only, all statuses).
 * POST  → create a new content_item (manual draft).
 * PATCH → update lifecycle / body / scheduling on an existing item.
 *
 * All routes admin-gated via isAdmin(user.email). Service-role client
 * is used after the gate so RLS doesn't block admin reads of non-
 * published rows.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}


// ─── GET ────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const kind   = searchParams.get('kind')
  const limit  = Math.min(Number(searchParams.get('limit') ?? 50), 200)

  let q = svc().from('growth_content_items')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (status) q = q.eq('status', status)
  if (kind)   q = q.eq('kind',   kind)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}


// ─── POST ───────────────────────────────────────────────────────

const ALLOWED_KINDS = [
  'strategy_of_the_week', 'backtest_breakdown', 'market_report',
  'product_update', 'psychology_insight', 'educational', 'announcement',
] as const

const createSchema = z.object({
  kind:           z.enum(ALLOWED_KINDS),
  title:          z.string().min(1).max(200),
  summary:        z.string().max(1000).optional(),
  body_md:        z.string().min(1),
  hero_image_url: z.string().url().optional(),
  tags:           z.array(z.string()).max(20).optional(),
  channels:       z.array(z.string()).max(20).optional(),
  provenance:     z.record(z.string(), z.unknown()).optional(),
  is_synthetic:   z.boolean().optional(),
  disclaimer:     z.string().max(1000).optional(),
  cta_text:       z.string().max(80).optional(),
  cta_url:        z.string().url().optional(),
})

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const insert = {
    ...parsed.data,
    tags:         parsed.data.tags     ?? [],
    channels:     parsed.data.channels ?? [],
    is_synthetic: parsed.data.is_synthetic ?? false,
    provenance:   parsed.data.provenance ?? { type: 'manual' },
    created_by:   g.user.id,
    status:       'draft' as const,
  }

  const { data, error } = await svc()
    .from('growth_content_items')
    .insert(insert)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}


// ─── PATCH ──────────────────────────────────────────────────────

const TRANSITIONS: Record<string, string[]> = {
  draft:     ['review', 'archived', 'rejected'],
  review:    ['approved', 'draft', 'rejected'],
  approved:  ['scheduled', 'published', 'draft', 'rejected'],
  scheduled: ['published', 'approved', 'rejected'],
  published: ['archived'],
  archived:  ['draft'],
  rejected:  ['draft', 'archived'],
}

const patchSchema = z.object({
  id:              z.string().uuid(),
  status:          z.enum(['draft','review','approved','scheduled','published','archived','rejected']).optional(),
  title:           z.string().min(1).max(200).optional(),
  summary:         z.string().max(1000).optional(),
  body_md:         z.string().min(1).optional(),
  hero_image_url:  z.string().url().nullable().optional(),
  tags:            z.array(z.string()).max(20).optional(),
  channels:        z.array(z.string()).max(20).optional(),
  disclaimer:      z.string().max(1000).optional(),
  cta_text:        z.string().max(80).optional(),
  cta_url:         z.string().url().optional(),
  scheduled_for:   z.string().datetime().nullable().optional(),
  rejected_reason: z.string().max(500).optional(),
})

export async function PATCH(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }
  const { id, status, ...rest } = parsed.data

  const db = svc()
  const { data: current, error: getErr } = await db
    .from('growth_content_items')
    .select('status, disclaimer')
    .eq('id', id)
    .single()
  if (getErr || !current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Enforce status-transition graph + compliance.
  const update: Record<string, unknown> = { ...rest }
  if (status && status !== current.status) {
    const allowed = TRANSITIONS[current.status] ?? []
    if (!allowed.includes(status)) {
      return NextResponse.json({
        error: `Cannot transition from ${current.status} → ${status}`,
      }, { status: 409 })
    }
    update.status = status

    // Compliance: never publish without a disclaimer.
    if (status === 'published') {
      const willHaveDisclaimer = (rest as { disclaimer?: string }).disclaimer
        ?? current.disclaimer
      if (!willHaveDisclaimer || !willHaveDisclaimer.trim()) {
        return NextResponse.json({
          error: 'Cannot publish without a non-empty disclaimer.',
        }, { status: 422 })
      }
      update.published_at = new Date().toISOString()
      update.approved_by  = g.user.id
    }
    if (status === 'review')   update.reviewed_by = g.user.id
    if (status === 'approved') update.approved_by = g.user.id
  }

  const { data, error } = await db
    .from('growth_content_items')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
