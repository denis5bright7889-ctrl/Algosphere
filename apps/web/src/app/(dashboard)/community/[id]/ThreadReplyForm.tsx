'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

export default function ThreadReplyForm({ threadId }: { threadId: string }) {
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    if (body.length < 1) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/threads/${threadId}/replies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        })
        if (!res.ok) {
          const e = await res.json()
          throw new Error(e.error ?? 'Failed')
        }
        setBody('')
        window.location.reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Write a reply..."
        rows={4}
        maxLength={2000}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
      />
      {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
      <div className="flex justify-between items-center mt-3">
        <span className="text-[10px] text-muted-foreground">
          {body.length} / 2000
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={pending || body.length < 1}
          className={cn(
            'btn-premium !py-1.5 !px-4 !text-xs',
            (pending || body.length < 1) && 'opacity-50 cursor-not-allowed',
          )}
        >
          {pending ? 'Posting…' : 'Reply'}
        </button>
      </div>
    </div>
  )
}
