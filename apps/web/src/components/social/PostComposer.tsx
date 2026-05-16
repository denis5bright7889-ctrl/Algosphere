'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

const POST_TYPES = [
  { key: 'text',         label: '📝 Post'        },
  { key: 'market_view',  label: '👁 Market View' },
  { key: 'analysis',     label: '🔬 Analysis'    },
  { key: 'milestone',    label: '🏆 Milestone'   },
] as const

const VISIBILITY = [
  { key: 'public',      label: 'Public'      },
  { key: 'followers',   label: 'Followers'   },
  { key: 'subscribers', label: 'Subscribers' },
] as const

interface Props {
  onPosted?: () => void
}

const MAX_LENGTH = 2000

export default function PostComposer({ onPosted }: Props) {
  const [body, setBody]     = useState('')
  const [type, setType]     = useState<typeof POST_TYPES[number]['key']>('text')
  const [vis,  setVis]      = useState<typeof VISIBILITY[number]['key']>('public')
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  const remaining = MAX_LENGTH - body.length
  const overLimit = remaining < 0

  function submit() {
    if (!body.trim() || overLimit) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/social/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, post_type: type, visibility: vis }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error || 'Failed to post')
        }
        setBody('')
        setType('text')
        setFocused(false)
        onPosted?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to post')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 mb-4">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder="Share your market view, signal, or analysis..."
        rows={focused ? 4 : 2}
        className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none transition-all"
        maxLength={MAX_LENGTH + 100}
      />

      {(focused || body.length > 0) && (
        <>
          <div className="flex items-center gap-2 flex-wrap mt-3 mb-3">
            <div className="flex gap-1 flex-wrap">
              {POST_TYPES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setType(t.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                    type === t.key
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 mb-2">{error}</p>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <select
                value={vis}
                onChange={e => setVis(e.target.value as typeof vis)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:border-amber-500/40"
              >
                {VISIBILITY.map(v => (
                  <option key={v.key} value={v.key}>{v.label}</option>
                ))}
              </select>
              <span className={cn(
                'text-[10px] tabular-nums',
                overLimit ? 'text-rose-400' : 'text-muted-foreground',
              )}>
                {remaining}
              </span>
            </div>
            <button
              onClick={submit}
              disabled={pending || !body.trim() || overLimit}
              className={cn(
                'btn-premium !py-2 !px-5 !text-xs',
                (pending || !body.trim() || overLimit) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {pending ? 'Posting…' : 'Post'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
