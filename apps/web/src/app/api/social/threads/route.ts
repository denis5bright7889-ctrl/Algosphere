import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const CATEGORIES = ['signals','strategy','risk','psychology','crypto','defi','general','announcements'] as const

// ─── GET /api/social/threads ────────────────────────────────
export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const sort     = searchParams.get('sort') ?? 'hot'   // hot|new|top
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 50)

  let query = supabase
    .from('discussion_threads')
    .select(`
      id, author_id, category, title, body, tags, is_locked, is_resolved,
      views_count, replies_count, votes_score, last_reply_at, created_at,
      profiles!discussion_threads_author_id_fkey ( public_handle )
    `)
    .limit(limit)

  if (category && CATEGORIES.includes(category as never)) {
    query = query.eq('category', category)
  }

  if (sort === 'new') {
    query = query.order('created_at', { ascending: false })
  } else if (sort === 'top') {
    query = query.order('votes_score', { ascending: false })
  } else {
    // hot: blend of votes + recency (server-side using SQL would be better)
    query = query
      .order('votes_score', { ascending: false })
      .order('created_at', { ascending: false })
  }

  const { data, error } = await query
  if (error) {
    console.error('threads list error:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
  return NextResponse.json({ threads: data ?? [] })
}

// ─── POST /api/social/threads ───────────────────────────────
const createSchema = z.object({
  category: z.enum(CATEGORIES),
  title:    z.string().min(5).max(200),
  body:     z.string().min(10).max(5000),
  tags:     z.array(z.string().max(20)).max(5).default([]),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  // Rate limit: 5 threads per hour
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('discussion_threads')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gte('created_at', cutoff)

  if ((count ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'Rate limit: 5 threads/hour' },
      { status: 429 },
    )
  }

  const { data, error } = await supabase
    .from('discussion_threads')
    .insert({
      author_id: user.id,
      ...parsed.data,
    })
    .select()
    .single()

  if (error) {
    console.error('thread create error:', error)
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
  return NextResponse.json({ thread: data }, { status: 201 })
}
