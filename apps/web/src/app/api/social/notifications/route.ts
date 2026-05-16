import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─── GET /api/social/notifications ──────────────────────────
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get('unread') === 'true'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50)

  let query = supabase
    .from('social_notifications')
    .select(`
      id, actor_id, notif_type, entity_type, entity_id, message, read, created_at,
      profiles!social_notifications_actor_id_fkey ( public_handle )
    `)
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) query = query.eq('read', false)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  const { count: unreadCount } = await supabase
    .from('social_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .eq('read', false)

  return NextResponse.json({
    notifications: data ?? [],
    unread_count:  unreadCount ?? 0,
  })
}

// ─── PATCH /api/social/notifications — mark read ────────────
const schema = z.object({
  ids:     z.array(z.string().uuid()).optional(),
  all:     z.boolean().optional(),
})

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  let query = supabase
    .from('social_notifications')
    .update({ read: true })
    .eq('recipient_id', user.id)

  if (parsed.data.all) {
    query = query.eq('read', false)
  } else if (parsed.data.ids && parsed.data.ids.length > 0) {
    query = query.in('id', parsed.data.ids)
  } else {
    return NextResponse.json({ error: 'Provide ids or all:true' }, { status: 422 })
  }

  const { error } = await query
  if (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
