import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─── GET /api/social/threads/[id]/replies ───────────────────
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('discussion_replies')
    .select(`
      id, thread_id, author_id, parent_reply_id, body,
      votes_score, is_solution, is_flagged, edited_at, created_at,
      profiles!discussion_replies_author_id_fkey ( public_handle )
    `)
    .eq('thread_id', id)
    .eq('is_flagged', false)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
  return NextResponse.json({ replies: data ?? [] })
}

// ─── POST /api/social/threads/[id]/replies ──────────────────
const schema = z.object({
  body:            z.string().min(1).max(2000),
  parent_reply_id: z.string().uuid().nullable().optional(),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  // Check thread is not locked
  const { data: thread } = await supabase
    .from('discussion_threads')
    .select('is_locked, author_id, title')
    .eq('id', id)
    .single()

  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  if (thread.is_locked) return NextResponse.json({ error: 'Thread is locked' }, { status: 403 })

  const { data: reply, error } = await supabase
    .from('discussion_replies')
    .insert({
      thread_id: id,
      author_id: user.id,
      ...parsed.data,
    })
    .select()
    .single()

  if (error) {
    console.error('reply error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }

  // Bump replies_count + last_reply_at on thread
  await supabase.rpc('exec_sql', { sql: '' }).then(() => {})  // best-effort
  await supabase
    .from('discussion_threads')
    .update({
      replies_count: (await supabase
        .from('discussion_replies')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', id)).count ?? 0,
      last_reply_at: new Date().toISOString(),
    })
    .eq('id', id)

  // Notification to thread author
  if (thread.author_id !== user.id) {
    await supabase.from('social_notifications').insert({
      recipient_id: thread.author_id,
      actor_id:     user.id,
      notif_type:   'new_comment',
      entity_type:  'thread',
      entity_id:    id,
      message:      `New reply on "${thread.title}"`,
    })
  }

  return NextResponse.json({ reply }, { status: 201 })
}
