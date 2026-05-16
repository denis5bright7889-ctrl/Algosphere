import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─── GET /api/social/posts ──────────────────────────────────
// Home feed: blend of following + trending + subscribed
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { searchParams } = new URL(req.url)
  const tab    = searchParams.get('tab') ?? 'home'
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50)
  const cursor = searchParams.get('cursor')

  let query = supabase
    .from('social_posts')
    .select(`
      id, author_id, post_type, body, media_urls, signal_id, trade_id,
      visibility, likes_count, comments_count, reposts_count, views_count,
      is_pinned, created_at,
      profiles!social_posts_author_id_fkey (
        public_handle, bio
      ),
      signals (id, pair, direction, entry_price, stop_loss, take_profit_1, risk_reward, lifecycle_state)
    `)
    .eq('visibility', 'public')
    .eq('is_flagged', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (cursor) query = query.lt('created_at', cursor)

  // For 'following' tab, filter to posts from people we follow
  if (tab === 'following' && user) {
    const { data: follows } = await supabase
      .from('trader_follows')
      .select('leader_id')
      .eq('follower_id', user.id)
    const ids = (follows ?? []).map(f => f.leader_id)
    if (ids.length === 0) {
      return NextResponse.json({ posts: [], next_cursor: null })
    }
    query = query.in('author_id', ids)
  }

  // Trending: sort by engagement in last 48h
  if (tab === 'trending') {
    query = supabase
      .from('social_posts')
      .select(`
        id, author_id, post_type, body, media_urls, signal_id, trade_id,
        visibility, likes_count, comments_count, reposts_count, views_count,
        is_pinned, created_at,
        profiles!social_posts_author_id_fkey ( public_handle, bio ),
        signals (id, pair, direction, entry_price, stop_loss, take_profit_1, risk_reward, lifecycle_state)
      `)
      .eq('visibility', 'public')
      .eq('is_flagged', false)
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('likes_count', { ascending: false })
      .limit(limit)
  }

  const { data, error } = await query
  if (error) {
    console.error('feed error:', error)
    return NextResponse.json({ error: 'Failed to load feed' }, { status: 500 })
  }

  // Mark which posts the current user has reacted to
  let reactedIds: Set<string> = new Set()
  if (user && data && data.length > 0) {
    const { data: reactions } = await supabase
      .from('social_post_reactions')
      .select('post_id')
      .eq('user_id', user.id)
      .in('post_id', data.map(p => p.id))
    reactedIds = new Set((reactions ?? []).map(r => r.post_id))
  }

  const posts = (data ?? []).map(p => ({
    ...p,
    user_reacted: reactedIds.has(p.id),
  }))

  const last = posts.length === limit ? posts[posts.length - 1] : null
  const nextCursor = last?.created_at ?? null
  return NextResponse.json({ posts, next_cursor: nextCursor })
}

// ─── POST /api/social/posts ─────────────────────────────────
// Create a new post
const createSchema = z.object({
  body:        z.string().min(1).max(2000),
  post_type:   z.enum(['text','signal_share','trade_share','market_view','analysis','milestone']).default('text'),
  signal_id:   z.string().uuid().nullable().optional(),
  trade_id:    z.string().uuid().nullable().optional(),
  media_urls:  z.array(z.string().url()).max(4).default([]),
  visibility:  z.enum(['public','followers','subscribers','private']).default('public'),
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

  // Rate limit: max 10 posts per hour
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gte('created_at', cutoff)

  if ((count ?? 0) >= 10) {
    return NextResponse.json(
      { error: 'Rate limit: 10 posts/hour' },
      { status: 429 },
    )
  }

  const { data, error } = await supabase
    .from('social_posts')
    .insert({
      author_id: user.id,
      ...parsed.data,
    })
    .select()
    .single()

  if (error) {
    console.error('post create error:', error)
    return NextResponse.json({ error: 'Failed to post' }, { status: 500 })
  }

  return NextResponse.json({ post: data }, { status: 201 })
}
