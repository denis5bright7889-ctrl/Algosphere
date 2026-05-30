/**
 * /api/admin/growth/schedule — schedule a content_item to one or more
 * channels.
 *
 * POST body:
 *   {
 *     content_id: uuid,
 *     channels:   string[],
 *     send_at:    ISO timestamp (optional — defaults to now())
 *   }
 *
 * Creates one growth_scheduled_posts row per channel. The worker (or
 * the post-now endpoint) drains queued rows when send_at <= now().
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const CHANNELS = [
  'x', 'telegram', 'discord', 'linkedin', 'instagram',
  'facebook', 'youtube', 'whatsapp_channel',
  'instagram_reels', 'youtube_shorts',
] as const

const schema = z.object({
  content_id: z.string().uuid(),
  channels:   z.array(z.enum(CHANNELS)).min(1).max(10),
  send_at:    z.string().datetime().optional(),
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

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }
  const { content_id, channels, send_at } = parsed.data

  // Guardrail: only schedule content that is at least approved + has a
  // non-empty disclaimer. Don't trust the client.
  const db = svc()
  const { data: ci } = await db
    .from('growth_content_items')
    .select('id, status, disclaimer')
    .eq('id', content_id)
    .single()
  if (!ci) return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  if (!['approved', 'scheduled', 'published'].includes(ci.status)) {
    return NextResponse.json({ error: `Content must be approved before scheduling (current status: ${ci.status})` }, { status: 409 })
  }
  if (!ci.disclaimer || !ci.disclaimer.trim()) {
    return NextResponse.json({ error: 'Cannot schedule — disclaimer is empty.' }, { status: 422 })
  }

  const sendIso = send_at ?? new Date().toISOString()
  const rows = channels.map((ch) => ({
    content_id,
    channel:     ch,
    send_at:     sendIso,
    status:      'queued' as const,
    created_by:  g.user.id,
  }))

  const { data, error } = await db
    .from('growth_scheduled_posts')
    .insert(rows)
    .select('*')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Bump the content_item to status='scheduled' (so the lifecycle UI
  // reflects what's happening) only if it isn't already published.
  if (ci.status === 'approved') {
    await db.from('growth_content_items')
      .update({ status: 'scheduled', scheduled_for: sendIso })
      .eq('id', content_id)
  }

  return NextResponse.json({ data }, { status: 201 })
}
