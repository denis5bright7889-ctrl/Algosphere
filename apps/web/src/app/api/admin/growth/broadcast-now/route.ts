/**
 * /api/admin/growth/broadcast-now — text + link to every configured
 * channel, immediately. No automation rules, no asset waits, no
 * scheduling. The operator hits this when they want VISIBLE posts in
 * Discord / Telegram / Facebook / etc. in the next minute.
 *
 * Body (POST JSON):
 *   {
 *     title:    string,            // required
 *     body:     string,            // required (markdown OK)
 *     channels: Channel[],         // required, non-empty
 *     cta_url?: string,            // optional, defaults to brand setting
 *     hero?:    string,            // optional image URL
 *   }
 *
 * Flow:
 *   1. Insert content_item with status='published', asset_state='none'
 *   2. Insert scheduled_posts (one per channel) with send_at=now()
 *   3. Call publishOne() for each row, in parallel
 *   4. Return per-channel results
 *
 * Admin-only. Bypasses the auto-publish whitelist by design — the
 * operator is the gatekeeper here.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { publishOne } from '@/lib/growth/scheduler'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 120

const ChannelSchema = z.enum([
  'x', 'telegram', 'discord', 'linkedin',
  'instagram', 'facebook', 'youtube',
  'whatsapp_channel', 'instagram_reels', 'youtube_shorts',
  'tiktok',
])

const schema = z.object({
  title:    z.string().min(2).max(200),
  body:     z.string().min(2).max(8000),
  channels: z.array(ChannelSchema).min(1),
  cta_url:  z.string().url().optional(),
  hero:     z.string().url().optional(),
})

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

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.format() }, { status: 422 })
  }
  const { title, body: bodyMd, channels, cta_url, hero } = parsed.data

  const db = svc()

  // 1. Content item
  const { data: content, error: ciErr } = await db
    .from('growth_content_items')
    .insert({
      kind:           'announcement',
      status:         'published',
      title,
      summary:        bodyMd.slice(0, 280),
      body_md:        bodyMd,
      tags:           ['broadcast'],
      is_synthetic:   false,
      cta_url:        cta_url ?? null,
      hero_image_url: hero    ?? null,
      asset_state:    'none',
      asset_kinds:    [],
      published_at:   new Date().toISOString(),
      provenance:     {
        type:     'broadcast_now',
        fired_by: g.user.email ?? g.user.id,
      },
    })
    .select('id')
    .single()

  if (ciErr || !content) {
    return NextResponse.json(
      { error: ciErr?.message ?? 'content_item insert failed' },
      { status: 500 },
    )
  }

  // 2. One scheduled_posts row per channel, all due now
  const sendAt = new Date().toISOString()
  const { data: rows, error: schedErr } = await db
    .from('growth_scheduled_posts')
    .insert(channels.map((ch) => ({
      content_id: content.id,
      channel:    ch,
      status:     'queued',
      send_at:    sendAt,
    })))
    .select('id, channel')

  if (schedErr || !rows) {
    return NextResponse.json(
      { error: schedErr?.message ?? 'scheduled_posts insert failed' },
      { status: 500 },
    )
  }

  // 3. Publish in parallel — each channel adapter handles its own auth
  const results = await Promise.all(rows.map(async (row) => {
    const out = await publishOne(row.id)
    return {
      channel:      row.channel,
      scheduled_id: row.id,
      ok:           out.ok,
      external_id:  out.external_id ?? null,
      external_url: out.external_url ?? null,
      error:        out.error ?? null,
    }
  }))

  const summary = {
    total:     results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed:    results.filter((r) => !r.ok).length,
  }

  return NextResponse.json({
    fired_at:   new Date().toISOString(),
    fired_by:   g.user.email ?? g.user.id,
    content_id: content.id,
    summary,
    results,
  }, { status: summary.failed > 0 ? 207 : 200 })
}
