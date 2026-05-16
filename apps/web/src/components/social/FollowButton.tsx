'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  leaderId:        string
  leaderHandle?:   string
  initialFollowing: boolean
  initialFollowers?: number
  size?: 'sm' | 'md'
  onChange?: (following: boolean) => void
}

export default function FollowButton({
  leaderId,
  leaderHandle,
  initialFollowing,
  initialFollowers = 0,
  size = 'md',
  onChange,
}: Props) {
  const [following, setFollowing] = useState(initialFollowing)
  const [followers, setFollowers] = useState(initialFollowers)
  const [pending, startTransition] = useTransition()
  const [hover, setHover]   = useState(false)
  const [error, setError]   = useState<string | null>(null)

  function toggle() {
    setError(null)
    startTransition(async () => {
      const wasFollowing = following
      // Optimistic update
      setFollowing(!wasFollowing)
      setFollowers(c => Math.max(0, c + (wasFollowing ? -1 : 1)))

      try {
        const res = await fetch('/api/social/follow', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ leader_id: leaderId }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setFollowing(data.following)
        onChange?.(data.following)
      } catch {
        // Rollback
        setFollowing(wasFollowing)
        setFollowers(c => Math.max(0, c + (wasFollowing ? 1 : -1)))
        setError('Failed to update. Try again.')
      }
    })
  }

  const sizeCls = size === 'sm'
    ? '!py-1.5 !px-3 !text-xs'
    : '!py-2.5 !px-5 !text-sm'

  const label = following
    ? hover ? `Unfollow${leaderHandle ? ` @${leaderHandle}` : ''}` : 'Following'
    : `Follow${leaderHandle ? ` @${leaderHandle}` : ''}`

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        disabled={pending}
        className={cn(
          'rounded-lg font-semibold transition-all',
          sizeCls,
          following
            ? hover
              ? 'border border-rose-500/50 bg-rose-500/10 text-rose-400'
              : 'border border-border bg-card text-foreground'
            : 'btn-premium',
          pending && 'opacity-60 cursor-wait',
        )}
      >
        {pending ? '…' : label}
      </button>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
      {followers > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {followers.toLocaleString()} follower{followers === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}
