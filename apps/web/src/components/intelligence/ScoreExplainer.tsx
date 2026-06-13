'use client'

/**
 * ScoreExplainer (Phase 8) — wraps any score with a click-to-open panel that
 * shows exactly why it exists: value, confidence, formula, inputs used,
 * inputs missing, and sample size. No score is a black box.
 *
 * Usage:
 *   <ScoreExplainer explanation={exp}><span>72/100</span></ScoreExplainer>
 */
import { useState } from 'react'
import { Info, X } from 'lucide-react'
import type { ScoreExplanation } from '@/lib/intelligence/explainability'
import { cn } from '@/lib/utils'

const CONF_STYLE: Record<string, string> = {
  high:         'text-emerald-600',
  medium:       'text-amber-600',
  low:          'text-orange-600',
  insufficient: 'text-muted-foreground',
}
const TRUST_STYLE: Record<string, string> = {
  High:         'text-emerald-600',
  Medium:       'text-amber-600',
  Low:          'text-orange-600',
  Insufficient: 'text-muted-foreground',
}

export default function ScoreExplainer({
  explanation, children,
}: {
  explanation: ScoreExplanation
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const e = explanation

  return (
    <span className="relative inline-flex items-center gap-1">
      {children}
      <button
        type="button"
        aria-label={`Why is ${e.label} ${e.value ?? 'Insufficient Data'}?`}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground/70 hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            className="absolute left-0 top-6 z-50 w-[320px] rounded-lg border border-border bg-card p-3 text-left text-[11px] shadow-xl"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold">{e.label}</p>
                <p className="text-muted-foreground">
                  {e.value == null ? 'Insufficient Data' : <>{e.value}{e.unit}</>}
                  {' · '}
                  <span className={cn('font-medium capitalize', CONF_STYLE[String(e.confidence).toLowerCase()] ?? '')}>
                    {e.confidence} confidence
                  </span>
                  {e.sample_size != null && <> · n={e.sample_size}</>}
                </p>
                {(e.trust_level || e.assurance) && (
                  <p className="text-muted-foreground">
                    {e.trust_level && (
                      <span className={cn('font-semibold', TRUST_STYLE[e.trust_level] ?? '')}>
                        Trust: {e.trust_level}
                      </span>
                    )}
                    {e.assurance && <> · {e.assurance} evidence</>}
                  </p>
                )}
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </button>
            </div>

            <p className="mb-2 rounded bg-muted/50 px-2 py-1.5 leading-relaxed text-foreground/90">
              <span className="font-medium">Formula: </span>{e.formula}
            </p>

            {e.inputs_used.length > 0 && (
              <div className="mb-1.5">
                <p className="font-medium text-foreground/80">Inputs used</p>
                <ul className="mt-0.5 space-y-0.5">
                  {e.inputs_used.map((i) => (
                    <li key={i.name} className="flex justify-between gap-2 text-muted-foreground">
                      <span>{i.name}</span>
                      <span className="tabular-nums text-foreground/80">{String(i.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {e.inputs_missing.length > 0 && (
              <div className="mb-1.5">
                <p className="font-medium text-orange-600/90">Missing (not scored)</p>
                <p className="mt-0.5 text-muted-foreground">{e.inputs_missing.join(', ')}</p>
              </div>
            )}

            {e.notes?.map((n, idx) => (
              <p key={idx} className="mt-1 text-[10px] italic text-muted-foreground">{n}</p>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
