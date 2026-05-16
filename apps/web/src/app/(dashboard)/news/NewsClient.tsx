'use client'

import { useEffect, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface NewsItem {
  title: string; url: string; source: string
  category: string; impact: string; published_at: string
}

const FILTERS = ['All', 'high', 'crypto', 'forex', 'macro'] as const

const IMPACT_CLS: Record<string, string> = {
  high:   'text-rose-300 border-rose-500/40 bg-rose-500/10',
  medium: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  low:    'text-muted-foreground border-border bg-muted/20',
}

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return new Date(ts).toLocaleDateString()
}

export default function NewsClient() {
  const [items, setItems]     = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const [filter, setFilter]   = useState<typeof FILTERS[number]>('All')

  useEffect(() => {
    fetch('/api/market/news')
      .then(r => r.json())
      .then(d => {
        setItems(d.items ?? [])
        setDegraded(!!d.degraded)
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'All')  return items
    if (filter === 'high') return items.filter(i => i.impact === 'high')
    return items.filter(i => i.category === filter)
  }, [items, filter])

  return (
    <div>
      <div className="flex gap-1 mb-4 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors capitalize',
              filter === f
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'high' ? '🔴 High Impact' : f}
          </button>
        ))}
      </div>

      {degraded && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 mb-4 text-xs text-muted-foreground">
          News feed temporarily degraded — showing cached items.
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Loading headlines…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No headlines match this filter.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n, i) => (
            <a
              key={i}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-amber-500/30 transition-colors"
            >
              <span className={cn(
                'rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase flex-shrink-0 mt-0.5',
                IMPACT_CLS[n.impact] ?? IMPACT_CLS.low,
              )}>
                {n.impact}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{n.title}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {n.source} · {n.category} · {timeAgo(n.published_at)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
