'use client'

import { useState } from 'react'
import { Flag, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const REASONS = [
  { key: 'spam',       label: 'Spam' },
  { key: 'harassment', label: 'Harassment' },
  { key: 'misleading', label: 'Misleading' },
  { key: 'illegal',    label: 'Illegal' },
  { key: 'other',      label: 'Other' },
] as const

type TargetType = 'social_post' | 'discussion_reply' | 'comment' | 'profile'

interface Props {
  targetType: TargetType
  targetId:   string
}

/**
 * Compact report flow. Collapsed: a single flag icon. Expanded: reason
 * pills. Confirmed: green check. Idempotent on the server side, so
 * re-reporting the same item is a no-op success.
 */
export default function ReportButton({ targetType, targetId }: Props) {
  const [phase, setPhase] = useState<'idle' | 'choosing' | 'sending' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function send(reason: string) {
    setPhase('sending')
    setErrMsg(null)
    try {
      const res = await fetch('/api/social/report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_type: targetType, target_id: targetId, reason }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setPhase('done')
      setTimeout(() => setPhase('idle'), 1800)
    } catch (e) {
      setPhase('error')
      setErrMsg(e instanceof Error ? e.message : 'Failed')
      setTimeout(() => setPhase('idle'), 2400)
    }
  }

  if (phase === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} aria-hidden />
        Reported
      </span>
    )
  }

  if (phase === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-rose-400" title={errMsg ?? ''}>
        Couldn&rsquo;t report
      </span>
    )
  }

  if (phase === 'choosing' || phase === 'sending') {
    return (
      <div className="inline-flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Reason:</span>
        {REASONS.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={phase === 'sending'}
            onClick={() => send(r.key)}
            className={cn(
              'rounded-full border border-border px-2 py-0.5 text-[10px] hover:border-amber-500/40 hover:text-amber-300 transition-colors',
              phase === 'sending' && 'opacity-50 cursor-not-allowed',
            )}
          >
            {r.label}
          </button>
        ))}
        {phase === 'sending'
          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
          : (
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
            >
              cancel
            </button>
          )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setPhase('choosing')}
      aria-label="Report"
      title="Report this content"
      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-rose-400"
    >
      <Flag className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </button>
  )
}
