'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

export interface SocialPost {
  id:             string
  author_id:      string
  post_type:      string
  body:           string
  media_urls:     string[]
  signal_id:      string | null
  trade_id:       string | null
  visibility:     string
  likes_count:    number
  comments_count: number
  reposts_count:  number
  views_count:    number
  is_pinned:      boolean
  created_at:     string
  user_reacted:   boolean
  profiles: {
    public_handle: string | null
    bio:           string | null
  } | null
  signals?: {
    id:            string
    pair:          string
    direction:     'buy' | 'sell'
    entry_price:   number
    stop_loss:     number
    take_profit_1: number | null
    risk_reward:   number | null
    lifecycle_state: string
  } | null
}

interface Props {
  post: SocialPost
  currentUserId?: string
}

function timeAgo(ts: string): string {
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (seconds < 60)     return `${seconds}s`
  if (seconds < 3600)   return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400)  return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  return new Date(ts).toLocaleDateString()
}

const POST_TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  signal_share: { label: '📊 Signal',     cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  trade_share:  { label: '📈 Trade',      cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  market_view:  { label: '👁 Market View', cls: 'text-blue-300 bg-blue-500/10 border-blue-500/30' },
  analysis:     { label: '🔬 Analysis',   cls: 'text-purple-300 bg-purple-500/10 border-purple-500/30' },
  milestone:    { label: '🏆 Milestone',  cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
}

export default function PostCard({ post, currentUserId }: Props) {
  const [liked, setLiked]   = useState(post.user_reacted)
  const [likes, setLikes]   = useState(post.likes_count)
  const [pending, startTransition] = useTransition()

  const author = post.profiles
  const badge  = POST_TYPE_BADGES[post.post_type]
  const isOwn  = currentUserId === post.author_id

  function toggleLike() {
    startTransition(async () => {
      const wasLiked = liked
      setLiked(!wasLiked)
      setLikes(c => Math.max(0, c + (wasLiked ? -1 : 1)))

      try {
        const res = await fetch(`/api/social/posts/${post.id}/react`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reaction: 'like' }),
        })
        if (!res.ok) throw new Error('Failed')
      } catch {
        setLiked(wasLiked)
        setLikes(c => Math.max(0, c + (wasLiked ? 1 : -1)))
      }
    })
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-5 hover:border-border/70 transition-colors">
      {/* Header */}
      <header className="flex items-start gap-3 mb-3">
        <a
          href={author?.public_handle ? `/traders/${author.public_handle}` : '#'}
          className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400/40 to-amber-700/40 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-300 flex-shrink-0"
        >
          {author?.public_handle?.[0]?.toUpperCase() ?? '?'}
        </a>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={author?.public_handle ? `/traders/${author.public_handle}` : '#'}
              className="font-semibold text-sm hover:text-amber-300 transition-colors"
            >
              @{author?.public_handle ?? 'anonymous'}
            </a>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{timeAgo(post.created_at)}</span>
            {badge && (
              <span className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold',
                badge.cls,
              )}>
                {badge.label}
              </span>
            )}
            {post.is_pinned && (
              <span className="text-[10px] text-amber-300">📌 Pinned</span>
            )}
          </div>
          {author?.bio && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{author.bio}</p>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="text-sm whitespace-pre-wrap leading-relaxed mb-3">
        {post.body}
      </div>

      {/* Attached signal */}
      {post.signals && <AttachedSignalCard signal={post.signals} />}

      {/* Reactions footer */}
      <footer className="mt-4 flex items-center gap-4 text-xs">
        <button
          onClick={toggleLike}
          disabled={pending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors',
            liked
              ? 'text-amber-300 bg-amber-500/10'
              : 'text-muted-foreground hover:text-amber-300 hover:bg-amber-500/5',
          )}
        >
          <span>{liked ? '🔥' : '🤍'}</span>
          <span className="font-semibold tabular-nums">{likes}</span>
        </button>
        <button className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          💬 <span className="tabular-nums">{post.comments_count}</span>
        </button>
        <button className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          🔄 <span className="tabular-nums">{post.reposts_count}</span>
        </button>
        <button className="ml-auto text-muted-foreground hover:text-foreground">
          🔖
        </button>
        {isOwn && (
          <button className="text-muted-foreground hover:text-rose-400" title="Delete">
            ⋯
          </button>
        )}
      </footer>
    </article>
  )
}

function AttachedSignalCard({ signal }: { signal: NonNullable<SocialPost['signals']> }) {
  const isBuy = signal.direction === 'buy'
  return (
    <a
      href={`/dashboard/signals#${signal.id}`}
      className="block rounded-xl border border-border bg-background/50 p-3 hover:border-amber-500/40 transition-colors mb-1"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{signal.pair}</span>
          <span className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-bold',
            isBuy
              ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
              : 'text-rose-300 border-rose-500/40 bg-rose-500/10',
          )}>
            {isBuy ? '🟢 BUY' : '🔴 SELL'}
          </span>
          {signal.lifecycle_state !== 'active' && (
            <span className="text-[10px] text-muted-foreground capitalize">
              · {signal.lifecycle_state.replace('_', ' ')}
            </span>
          )}
        </div>
        {signal.risk_reward && (
          <span className="text-[10px] text-muted-foreground">
            R:R {signal.risk_reward.toFixed(2)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="text-muted-foreground">Entry</p>
          <p className="font-mono tabular-nums">{signal.entry_price}</p>
        </div>
        <div>
          <p className="text-muted-foreground">SL</p>
          <p className="font-mono tabular-nums text-rose-400">{signal.stop_loss}</p>
        </div>
        <div>
          <p className="text-muted-foreground">TP1</p>
          <p className="font-mono tabular-nums text-emerald-400">
            {signal.take_profit_1 ?? '—'}
          </p>
        </div>
      </div>
    </a>
  )
}
