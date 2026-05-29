/**
 * PATCH /api/admin/communities/[id]
 * DELETE /api/admin/communities/[id]?hard=true
 *
 * Item-level admin endpoints for the Telegram Community Hub.
 *
 *   PATCH — partial update. Every field is optional. Slug and URL are
 *           re-normalized server-side. is_pinned / is_featured toggles
 *           are common operations from the admin table.
 *
 *   DELETE — soft-archives by default (sets archived_at = now()). Pass
 *            ?hard=true to fully delete the row. Soft archive keeps
 *            history; hard delete is the "I made a typo" escape hatch.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import {
  COMMUNITY_KINDS, COMMUNITY_CATEGORIES,
  SLUG_RE, normalizeSlug, parseTelegramUrl,
} from '@/lib/telegram-communities'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  slug:         z.string().max(40).optional(),
  name:         z.string().min(2).max(80).optional(),
  description:  z.string().max(500).nullish(),
  telegram_url: z.string().optional(),
  kind:         z.enum(COMMUNITY_KINDS).optional(),
  category:     z.enum(COMMUNITY_CATEGORIES).optional(),
  visibility:   z.enum(['free', 'starter', 'premium', 'vip']).optional(),
  is_featured:  z.boolean().optional(),
  is_pinned:    z.boolean().optional(),
  sort_order:   z.number().int().min(0).max(10_000).optional(),
  icon_url:     z.string().url().nullish(),
  banner_url:   z.string().url().nullish(),
  member_count: z.number().int().min(0).nullish(),
  // Explicit un-archive: set archived_at: null. Anything else gets
  // ignored — archive happens via DELETE, not PATCH.
  unarchive:    z.boolean().optional(),
})

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { user, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user, error: null }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error: gateErr } = await requireAdmin()
  if (gateErr) return gateErr

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }

  // Build the update object piecewise so we never write `undefined`.
  const update: Record<string, unknown> = {}
  const d = parsed.data

  if (d.slug !== undefined) {
    const slug = normalizeSlug(d.slug)
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ error: 'invalid_slug' }, { status: 422 })
    }
    update.slug = slug
  }
  if (d.name !== undefined)         update.name         = d.name.trim()
  if (d.description !== undefined)  update.description  = d.description?.trim() || null
  if (d.telegram_url !== undefined) {
    const url = parseTelegramUrl(d.telegram_url)
    if (!url) {
      return NextResponse.json(
        { error: 'invalid_telegram_url', detail: 'must be an https://t.me/... or https://telegram.me/... URL' },
        { status: 422 },
      )
    }
    update.telegram_url = url
  }
  if (d.kind !== undefined)         update.kind         = d.kind
  if (d.category !== undefined)     update.category     = d.category
  if (d.visibility !== undefined)   update.visibility   = d.visibility
  if (d.is_featured !== undefined)  update.is_featured  = d.is_featured
  if (d.is_pinned !== undefined)    update.is_pinned    = d.is_pinned
  if (d.sort_order !== undefined)   update.sort_order   = d.sort_order
  if (d.icon_url !== undefined)     update.icon_url     = d.icon_url || null
  if (d.banner_url !== undefined)   update.banner_url   = d.banner_url || null
  if (d.member_count !== undefined) update.member_count = d.member_count ?? null
  if (d.unarchive === true)         update.archived_at  = null

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 422 })
  }

  const svc = createServiceClient()
  const { data, error: updErr } = await svc
    .from('telegram_communities')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (updErr) {
    if (updErr.code === '23505') {
      return NextResponse.json({ error: 'slug_taken' }, { status: 409 })
    }
    if (updErr.code === 'PGRST116') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    console.error('admin communities patch failed', updErr)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({ community: data })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error: gateErr } = await requireAdmin()
  if (gateErr) return gateErr

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const hard = new URL(req.url).searchParams.get('hard') === 'true'
  const svc = createServiceClient()

  if (hard) {
    const { error: delErr } = await svc.from('telegram_communities').delete().eq('id', id)
    if (delErr) {
      console.error('admin communities hard-delete failed', delErr)
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, mode: 'hard' })
  }

  const { error: archErr } = await svc
    .from('telegram_communities')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (archErr) {
    console.error('admin communities archive failed', archErr)
    return NextResponse.json({ error: 'archive_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mode: 'archive' })
}
