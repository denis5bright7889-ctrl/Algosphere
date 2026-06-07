'use client'

/**
 * Workspace-scoped error boundary.
 *
 * Catches throws inside /workspace before they bubble to the dashboard-
 * wide boundary at (dashboard)/error.tsx. Surfaces the ACTUAL error
 * message + offers a one-click "Reset workspace state" button that
 * clears the localStorage row + reloads — the most common cause of
 * /workspace crashes is a malformed persisted state from a prior
 * schema version or manual devtools edit, which the next mount
 * re-creates fresh.
 *
 * The dashboard-wide boundary only shows a generic "Something went
 * wrong" message; this one shows the developer-readable message so
 * the user can copy-paste it to support, and includes the recovery
 * action they actually need.
 */
import { useEffect } from 'react'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { STORAGE_KEY } from '@/lib/workspace-store'

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[workspace] route error:', error)
  }, [error])

  function resetState() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // ignore; reset() below will still re-mount with the in-memory default
    }
    reset()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
      <AlertTriangle className="h-12 w-12 text-amber-300/80" strokeWidth={1.5} aria-hidden />
      <h1 className="mt-4 text-xl font-bold tracking-tight">
        Chart workspace error
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The workspace crashed before it could render. The most common cause
        is a malformed saved workspace from a prior version — clearing it
        rebuilds with a fresh default chart.
      </p>

      {/* Actual error message — gives the operator something to act on. */}
      <pre className="mt-4 w-full max-w-md whitespace-pre-wrap rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-left text-[11px] font-mono text-rose-200/90">
        {error.message || 'Unknown error'}
      </pre>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={resetState}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
          Reset workspace + retry
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
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
