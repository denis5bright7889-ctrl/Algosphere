'use client'

import { useState, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import PostCard, { type SocialPost } from '@/components/social/PostCard'
import PostComposer from '@/components/social/PostComposer'

const TABS = [
  { key: 'home',      label: 'Home'      },
  { key: 'following', label: 'Following' },
  { key: 'trending',  label: 'Trending'  },
] as const

interface Props {
  initialPosts: SocialPost[]
  currentUserId: string
}

export default function SocialFeedClient({ initialPosts, currentUserId }: Props) {
  const [tab, setTab]   = useState<typeof TABS[number]['key']>('home')
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const fetchFeed = useCallback(async (forTab: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/social/posts?tab=${forTab}&limit=30`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setPosts(data.posts ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Only refetch when tab actually changes (skip initial home — already SSR-loaded)
    if (tab !== 'home' || posts.length === 0) {
      fetchFeed(tab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const onPosted = () => fetchFeed(tab)

  return (
    <>
      <PostComposer onPosted={onPosted} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.key
                ? 'text-amber-300'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-300" />
            )}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="space-y-3">
        {loading && posts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
            {error}
          </div>
        )}

        {!loading && posts.length === 0 && !error && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {tab === 'following'
              ? 'You aren\'t following anyone yet. Visit the leaderboard to discover traders.'
              : 'No posts yet. Be the first to share a market view.'}
          </div>
        )}

        {posts.map(p => (
          <PostCard key={p.id} post={p} currentUserId={currentUserId} />
        ))}
      </div>
    </>
  )
}
