'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, ExternalLink, Loader2, CheckCircle2, XCircle, Copy } from 'lucide-react'

interface Row {
  id:              string
  source:          string
  url:             string
  title:           string
  snippet:         string | null
  author:          string | null
  posted_at:       string | null
  topic_tags:      string[]
  status:          string
  ai_reply_draft:  string | null
  relevance:       number | null
}

export default function DiscoveryClient({ initial }: { initial: Row[] }) {
  const [items, setItems] = useState<Row[]>(initial)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()
  const router = useRouter()

  async function draftReply(id: string) {
    setError(null); setPendingId(id)
    try {
      const res = await fetch('/api/admin/growth/discovery/draft-reply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Draft failed'); return }
      setItems((arr) => arr.map((r) => r.id === id ? { ...r, ai_reply_draft: json.draft, status: 'drafting' } : r))
    } finally {
      setPendingId(null)
    }
  }

  async function setStatus(id: string, status: 'replied' | 'dismissed') {
    setError(null)
    start(async () => {
      const res = await fetch('/api/admin/growth/discovery/status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Update failed')
        return
      }
      setItems((arr) => arr.filter((r) => r.id !== id))
      router.refresh()
    })
  }

  async function copyDraft(text: string) {
    try { await navigator.clipboard.writeText(text) } catch {}
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {items.map((r) => (
        <article key={r.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              {r.source}
            </span>
            {r.relevance != null && (
              <span className={
                'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ' + (
                  r.relevance >= 40 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : r.relevance >= 25 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'
                )
              }>
                relevance {r.relevance}
              </span>
            )}
            {r.topic_tags.map(t => (
              <span key={t} className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{t}</span>
            ))}
            {r.posted_at && (
              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                {new Date(r.posted_at).toLocaleString()}
              </span>
            )}
          </div>

          <h3 className="mt-2 text-sm font-bold leading-snug">{r.title}</h3>
          {r.snippet && (
            <p className="mt-1.5 line-clamp-3 text-[12px] text-foreground/80">{r.snippet}</p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {r.author && <>by u/{r.author} · </>}
            <a href={r.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-amber-300 hover:underline">
              open thread <ExternalLink className="h-3 w-3" />
            </a>
          </p>

          {r.ai_reply_draft ? (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-300/80">AI reply draft</p>
              <p className="whitespace-pre-wrap text-[13px] text-foreground/90">{r.ai_reply_draft}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyDraft(r.ai_reply_draft!)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-[11px] font-bold hover:bg-accent/40"
                >
                  <Copy className="h-3 w-3" /> Copy draft
                </button>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-black hover:bg-amber-400"
                >
                  <ExternalLink className="h-3 w-3" /> Open thread to post
                </a>
                <button
                  type="button"
                  onClick={() => setStatus(r.id, 'replied')}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/30"
                >
                  <CheckCircle2 className="h-3 w-3" /> Mark replied
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(r.id, 'dismissed')}
                  className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/30"
                >
                  <XCircle className="h-3 w-3" /> Dismiss
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => draftReply(r.id)}
                disabled={pendingId === r.id}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {pendingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Draft AI reply
              </button>
              <button
                type="button"
                onClick={() => setStatus(r.id, 'dismissed')}
                className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/30"
              >
                <XCircle className="h-3 w-3" /> Dismiss
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
