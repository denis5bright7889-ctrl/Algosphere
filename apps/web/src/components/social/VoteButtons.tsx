'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  targetType: 'thread' | 'reply'
  targetId:   string
  initialScore: number
  initialVote?: -1 | 0 | 1
  orientation?: 'vertical' | 'horizontal'
}

export default function VoteButtons({
  targetType,
  targetId,
  initialScore,
  initialVote = 0,
  orientation = 'vertical',
}: Props) {
  const [score, setScore] = useState(initialScore)
  const [vote, setVote]   = useState<-1 | 0 | 1>(initialVote)
  const [pending, startTransition] = useTransition()

  function cast(next: -1 | 1) {
    const newVote: -1 | 0 | 1 = vote === next ? 0 : next
    const prevVote  = vote
    const prevScore = score

    // Optimistic
    setVote(newVote)
    setScore(s => s - prevVote + newVote)

    startTransition(async () => {
      try {
        const res = await fetch('/api/social/vote', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            target_type: targetType,
            target_id:   targetId,
            vote:        newVote,
          }),
        })
        if (!res.ok) throw new Error('Failed')
      } catch {
        setVote(prevVote)
        setScore(prevScore)
      }
    })
  }

  const layout = orientation === 'vertical'
    ? 'flex-col'
    : 'flex-row items-center'

  return (
    <div className={cn('flex items-center gap-1', layout)}>
      <button
        type="button"
        onClick={() => cast(1)}
        disabled={pending}
        className={cn(
          'rounded p-0.5 text-sm transition-colors',
          vote === 1 ? 'text-amber-300' : 'text-muted-foreground hover:text-amber-300',
        )}
        aria-label="Upvote"
      >
        ▲
      </button>
      <span className={cn(
        'text-xs font-bold tabular-nums',
        score > 0 ? 'text-amber-300' : score < 0 ? 'text-rose-400' : 'text-muted-foreground',
      )}>
        {score}
      </span>
      <button
        type="button"
        onClick={() => cast(-1)}
        disabled={pending}
        className={cn(
          'rounded p-0.5 text-sm transition-colors',
          vote === -1 ? 'text-rose-400' : 'text-muted-foreground hover:text-rose-400',
        )}
        aria-label="Downvote"
      >
        ▼
      </button>
    </div>
  )
}
