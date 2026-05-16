import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SocialFeedClient from './SocialFeedClient'

export const metadata = {
  title: 'Social Feed — AlgoSphere Quant',
}

export const dynamic = 'force-dynamic'

export default async function SocialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Initial server-side fetch for fast first paint
  const { data: posts } = await supabase
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
    .order('created_at', { ascending: false })
    .limit(20)

  const initialPosts = (posts ?? []).map(p => ({ ...p, user_reacted: false }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-1">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient">Social</span> Feed
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Market views and signals from verified traders.
          </p>
        </div>
        <a
          href="/dashboard/social/discover"
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-amber-500/40 hover:text-amber-300 transition-colors whitespace-nowrap"
        >
          🔍 Discover Traders
        </a>
      </header>

      <SocialFeedClient
        initialPosts={initialPosts as never[]}
        currentUserId={user.id}
      />
    </div>
  )
}
