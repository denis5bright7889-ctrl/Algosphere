'use client'

import { useState, useTransition } from 'react'
import { X, EyeOff, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  r: {
    id:           string
    target_type:  string
    target_id:    string
    reason:       string
    notes:        string | null
    created_at:   string
    reporter:     { handle: string | null }
    body:         string | null
    authorHandle: string | null
  }
  readOnly?: boolean
}

export default function ReportRow({ r, readOnly = false }: Props) {
  const [resolved, setResolved] = useState<'dismiss' | 'action' | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function resolve(action: 'dismiss' | 'action') {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/reports/${r.id}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error ?? `HTTP ${res.status}`)
        }
        setResolved(action)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <article className={cn(
      'rounded-2xl border border-border/70 bg-card/40 p-4',
      resolved && 'opacity-60',
    )}>
      <header className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-bold text-rose-300 capitalize">
          {r.reason}
        </span>
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 capitalize text-muted-foreground">
          {r.target_type.replace('_', ' ')}
        </span>
        <span className="text-muted-foreground">
          Reported by <strong className="text-foreground">@{r.reporter.handle ?? 'anon'}</strong>
          {' · '}
          {new Date(r.created_at).toLocaleString()}
        </span>
      </header>

      {/* Target preview */}
      {r.body ? (
        <blockquote className="mb-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
          <p className="text-xs text-muted-foreground mb-1">
            @{r.authorHandle ?? 'unknown'}
          </p>
          <p className="text-sm whitespace-pre-wrap">{r.body}</p>
        </blockquote>
      ) : (
        <p className="mb-3 text-xs italic text-muted-foreground">Target content not previewable here.</p>
      )}

      {r.notes && (
        <p className="mb-3 text-xs text-muted-foreground">
          Notes: <em>&ldquo;{r.notes}&rdquo;</em>
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {resolved === 'action' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Hidden
            </span>
          ) : resolved === 'dismiss' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Dismissed
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => resolve('dismiss')}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent/50"
              >
                {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => resolve('action')}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
              >
                {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                <EyeOff className="h-3 w-3" strokeWidth={2} aria-hidden />
                Hide content
              </button>
              {r.target_type === 'social_post' && (
                <a
                  href="/social"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  target="_blank" rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                  Open feed
                </a>
              )}
            </>
          )}
          {error && <span className="ml-2 text-xs text-rose-400">{error}</span>}
        </div>
      )}
    </article>
  )
}
