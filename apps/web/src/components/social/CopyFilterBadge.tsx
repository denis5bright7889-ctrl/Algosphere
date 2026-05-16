'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { verdictBadge, type FilterResult } from '@/lib/copy-filter'

interface Props {
  userId: string
}

/**
 * Surfaces the Copy-Filter AI verdict for a trader. Fetches lazily
 * client-side so it doesn't block the profile SSR.
 */
export default function CopyFilterBadge({ userId }: Props) {
  const [result, setResult] = useState<FilterResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/social/copy-filter/${userId}`)
      .then(async r => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}))
          throw new Error(e.error ?? 'unavailable')
        }
        return r.json() as Promise<FilterResult>
      })
      .then(d => { if (active) setResult(d) })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'unavailable') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [userId])

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground">Running copy-filter analysis…</p>
      </div>
    )
  }
  if (error || !result) return null   // silent if no track record

  const badge = verdictBadge(result.verdict)

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Copy-Filter AI Verdict
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold',
              badge.cls,
            )}>
              {badge.label}
            </span>
            <span className="text-2xl font-bold tabular-nums text-amber-300 glow-text-gold">
              {result.trustScore}
              <span className="text-xs text-muted-foreground font-normal">/100</span>
            </span>
          </div>
        </div>
        {result.flags.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-[11px] text-amber-300 hover:underline"
          >
            {expanded ? 'Hide details' : `Why? (${result.flags.length} flag${result.flags.length === 1 ? '' : 's'})`}
          </button>
        )}
      </div>

      {/* Trust score bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            result.trustScore >= 65 ? 'bg-emerald-500'
            : result.trustScore >= 40 ? 'bg-amber-500'
            : 'bg-rose-500',
          )}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ width: `${result.trustScore}%` }}
        />
      </div>

      {expanded && result.reasons.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {result.reasons.map(r => (
            <li key={r} className="text-muted-foreground flex gap-2">
              <span className="text-rose-400">⚠</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        Composite trust score from sample-size, risk-adjusted returns, drawdown control,
        follower outcomes, and manipulation pattern detection.
      </p>
    </div>
  )
}
