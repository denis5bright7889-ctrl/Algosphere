/**
 * Admin CRUD for the Telegram Community Hub (Refocus R3).
 *
 *   GET  /api/admin/communities?include_archived=true
 *        Returns every row (newest first). Optional flag includes
 *        archived rows for the admin "trash" view.
 *
 *   POST /api/admin/communities
 *        Body validated by zod — see createSchema below. Uses the
 *        service-role client to bypass RLS (the table has no INSERT
 *        policy). Admin-only.
 *
 * Auth: isAdmin (lib/admin) — bot/account check via ADMIN_EMAIL env.
 *
 * The PATCH/DELETE handlers live in ./[id]/route.ts.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import {
  COMMUNITY_KINDS, COMMUNITY_CATEGORIES, COMMUNITY_VISIBILITIES,
  SLUG_RE, normalizeSlug, parseTelegramUrl,
} from '@/lib/telegram-communities'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  slug:         z.string().max(40).optional(),    // auto-derived from name if absent
  name:         z.string().min(2).max(80),
  description:  z.string().max(500).nullish(),
  telegram_url: z.string(),                       // validated by parseTelegramUrl below
  kind:         z.enum(COMMUNITY_KINDS).default('group'),
  category:     z.enum(COMMUNITY_CATEGORIES).default('discussion'),
  visibility:   z.enum(['free', 'starter', 'premium', 'vip']).default('free'),
  is_featured:  z.boolean().default(false),
  is_pinned:    z.boolean().default(false),
  sort_order:   z.number().int().min(0).max(10_000).default(100),
  icon_url:     z.string().url().nullish(),
  banner_url:   z.string().url().nullish(),
  member_count: z.number().int().min(0).nullish(),
})

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { user, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, error: null }
}

export async function GET(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  const includeArchived = new URL(req.url).searchParams.get('include_archived') === 'true'

  const svc = createServiceClient()
  let q = svc.from('telegram_communities')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(500)

  if (!includeArchived) q = q.is('archived_at', null)

  const { data, error: listErr } = await q
  if (listErr) {
    console.error('admin communities list failed', listErr)
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }
  return NextResponse.json({ communities: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }

  // Slug: explicit > derived-from-name. Always normalize to enforce
  // the slug rules even when the admin types something close.
  const rawSlug = parsed.data.slug || parsed.data.name
  const slug = normalizeSlug(rawSlug)
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'invalid_slug', detail: 'must be 2–40 lowercase chars, dashes allowed' }, { status: 422 })
  }

  // Telegram URL guard. Surface a friendly message rather than a 500
  // when the admin pastes a non-Telegram link.
  const url = parseTelegramUrl(parsed.data.telegram_url)
  if (!url) {
    return NextResponse.json(
      { error: 'invalid_telegram_url', detail: 'must be an https://t.me/... or https://telegram.me/... URL' },
      { status: 422 },
    )
  }

  const svc = createServiceClient()
  const { data, error: insErr } = await svc
    .from('telegram_communities')
    .insert({
      slug,
      name:         parsed.data.name.trim(),
      description:  parsed.data.description?.trim() || null,
      telegram_url: url,
      kind:         parsed.data.kind,
      category:     parsed.data.category,
      visibility:   parsed.data.visibility,
      is_featured:  parsed.data.is_featured,
      is_pinned:    parsed.data.is_pinned,
      sort_order:   parsed.data.sort_order,
      icon_url:     parsed.data.icon_url || null,
      banner_url:   parsed.data.banner_url || null,
      member_count: parsed.data.member_count ?? null,
    })
    .select()
    .single()

  if (insErr) {
    if (insErr.code === '23505') {
      return NextResponse.json(
        { error: 'slug_taken', detail: `community with slug "${slug}" already exists` },
        { status: 409 },
      )
    }
    console.error('admin communities create failed', insErr)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }

  return NextResponse.json({ community: data }, { status: 201 })
}
