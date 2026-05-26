'use client'

import { useEffect } from 'react'
import { GraduationCap, RotateCcw } from 'lucide-react'

/**
 * Route-level error boundary for the Education Hub. Any server/render
 * failure under /learn lands here instead of the bare Next.js crash
 * page — the user always sees a recoverable, on-brand fallback.
 */
export default function LearnError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[learn] route error:', error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <GraduationCap className="mx-auto h-12 w-12 text-amber-300/80" strokeWidth={1.5} aria-hidden />
      <h1 className="mt-4 text-xl font-bold tracking-tight">
        Education Hub temporarily unavailable
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        We hit a snag loading the Academy. Your progress is saved locally and
        nothing was lost. Try again in a moment.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
          Retry
        </button>
        <a
          href="/overview"
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to dashboard
        </a>
      </div>
      {error.digest && (
        <p className="mt-6 font-mono text-[10px] text-muted-foreground/50">
          ref: {error.digest}
        </p>
      )}
    </div>
  )
}
