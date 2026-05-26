'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Dashboard-wide error boundary. Catches any unhandled server/render
 * exception in a dashboard route that doesn't have its own closer
 * boundary, so the app degrades to a recoverable screen instead of
 * the bare "A server error occurred" page.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard] route error:', error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
      <AlertTriangle className="h-12 w-12 text-amber-300/80" strokeWidth={1.5} aria-hidden />
      <h1 className="mt-4 text-xl font-bold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This page failed to load. The rest of the app is unaffected — try
        again, or head back to your dashboard.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
          Try again
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
