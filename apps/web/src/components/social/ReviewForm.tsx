'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  strategyId: string
  canReview:  boolean    // false if creator or already reviewed
}

export default function ReviewForm({ strategyId, canReview }: Props) {
  const [open, setOpen]   = useState(false)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody]   = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState(false)

  if (!canReview) return null

  function submit() {
    setError(null)
    if (rating < 1) return setError('Pick a star rating')

    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/strategies/${strategyId}/reviews`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ rating, title, body }),
        })
        if (!res.ok) {
          const e = await res.json()
          throw new Error(e.error ?? 'Failed')
        }
        setDone(true)
        setTimeout(() => window.location.reload(), 1200)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3 text-xs text-emerald-300">
        ✓ Review submitted. Thanks for the feedback!
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:border-amber-500/40 hover:text-amber-300 transition-colors"
      >
        Write a Review
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-3">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="text-2xl transition-transform hover:scale-110"
            aria-label={`Rate ${n} stars`}
          >
            <span className={cn(
              (hover || rating) >= n ? 'text-amber-300' : 'text-muted-foreground/30',
            )}>
              ★
            </span>
          </button>
        ))}
      </div>

      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Review title (optional)"
        maxLength={100}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
      />

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Share your experience with this strategy..."
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
      />

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/30"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={cn(
            'btn-premium !py-1.5 !px-4 !text-xs',
            pending && 'opacity-60 cursor-wait',
          )}
        >
          {pending ? 'Submitting…' : 'Submit Review'}
        </button>
      </div>
    </div>
  )
}
