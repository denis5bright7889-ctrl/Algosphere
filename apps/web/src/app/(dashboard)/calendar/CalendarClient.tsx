'use client'

import { useEffect, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface EconEvent {
  title:    string
  country:  string
  date:     string
  impact:   string
  forecast: string
  previous: string
}

const IMPACT_CLS: Record<string, string> = {
  High:    'text-rose-300 border-rose-500/40 bg-rose-500/10',
  Medium:  'text-amber-300 border-amber-500/40 bg-amber-500/10',
  Low:     'text-muted-foreground border-border bg-muted/20',
  Holiday: 'text-blue-300 border-blue-500/30 bg-blue-500/10',
}

const FILTERS = ['All', 'High', 'Medium'] as const

export default function CalendarClient() {
  const [events, setEvents] = useState<EconEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const [filter, setFilter] = useState<typeof FILTERS[number]>('High')

  useEffect(() => {
    fetch('/api/market/calendar')
      .then(r => r.json())
      .then(d => {
        setEvents(d.events ?? [])
        setDegraded(!!d.degraded)
      })
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    const filtered = events.filter(e =>
      filter === 'All' ? true : e.impact === filter
    )
    const map = new Map<string, EconEvent[]>()
    for (const e of filtered) {
      const day = e.date ? new Date(e.date).toDateString() : 'TBD'
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(e)
    }
    return Array.from(map.entries())
  }, [events, filter])

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
              filter === f
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'All' ? 'All Events' : `${f} Impact`}
          </button>
        ))}
      </div>

      {degraded && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3 mb-4 text-xs text-muted-foreground">
          Live feed temporarily unavailable — showing cached data.
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Loading calendar…
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No {filter !== 'All' ? `${filter}-impact ` : ''}events this week.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, evs]) => (
            <div key={day}>
              <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-2">
                {day}
              </h2>
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                {evs.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/10"
                  >
                    <span className="text-[11px] font-mono text-muted-foreground w-12 flex-shrink-0">
                      {e.date ? new Date(e.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                    <span className="text-xs font-bold w-8 flex-shrink-0">{e.country}</span>
                    <span className="text-sm flex-1 truncate">{e.title}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums hidden sm:block">
                      F: {e.forecast || '—'} · P: {e.previous || '—'}
                    </span>
                    <span className={cn(
                      'rounded-full border px-2 py-0.5 text-[9px] font-bold flex-shrink-0',
                      IMPACT_CLS[e.impact] ?? IMPACT_CLS.Low,
                    )}>
                      {e.impact}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
