'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

const CATEGORIES = [
  'signals','strategy','risk','psychology','crypto','defi','general',
] as const

interface Props {
  currentUserId: string
}

export default function CommunityClient({}: Props) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('general')
  const [title, setTitle] = useState('')
  const [body, setBody]   = useState('')
  const [tags, setTags]   = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (title.length < 5) return setError('Title must be at least 5 characters')
    if (body.length < 10) return setError('Body must be at least 10 characters')

    startTransition(async () => {
      try {
        const res = await fetch('/api/social/threads', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            category,
            title,
            body,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')
        window.location.href = `/dashboard/community/${data.thread.id}`
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-premium !py-2 !px-4 !text-xs"
      >
        + New Discussion
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="rounded-2xl border border-border bg-card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">New Discussion</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Category
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as typeof CATEGORIES[number])}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c} className="capitalize">{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="What's the topic?"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Body
                </label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  placeholder="Share your thoughts, question, or insight..."
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
                />
                <p className="text-[10px] text-muted-foreground text-right mt-1">
                  {body.length} / 5000
                </p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Tags <span className="opacity-60">(comma-separated, max 5)</span>
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  placeholder="e.g. xauusd, scalping, psychology"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
                />
              </div>

              {error && <p className="text-xs text-rose-400">{error}</p>}

              <div className="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted/30"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className={cn(
                    'btn-premium !py-2 !px-5 !text-xs',
                    pending && 'opacity-60 cursor-wait',
                  )}
                >
                  {pending ? 'Posting…' : 'Post Discussion'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
