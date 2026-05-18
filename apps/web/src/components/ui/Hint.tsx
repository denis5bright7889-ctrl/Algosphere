'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Progressive-disclosure hint — the "beginner mode" the briefs keep
 * asking for, done as one reusable primitive instead of scattershot
 * tooltips.
 *
 * Behaviour:
 *  - A small "?" affordance. Click → inline explainer popover.
 *  - "Got it" persists dismissal in localStorage under `id`, so a
 *    returning user is never nagged again. New/curious users can
 *    still re-open it any time via the "?" (dismissal only hides the
 *    auto-call-out, never the affordance).
 *  - SSR-safe (renders nothing data-bound until mounted), keyboard
 *    accessible (Esc closes, aria-expanded), and self-contained.
 *
 * Honest by design: this only ever explains UI that already exists —
 * it never asserts data or state.
 */
export default function Hint({
  id,
  title,
  children,
  className,
}: {
  /** Stable key for the per-user dismissal memory. */
  id: string
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(true) // assume dismissed until we read storage (no SSR flash)
  const popRef = useRef<HTMLDivElement>(null)
  const domId = useId()
  const storeKey = `as_hint_${id}`

  useEffect(() => {
    setMounted(true)
    try {
      setDismissed(localStorage.getItem(storeKey) === '1')
    } catch {
      setDismissed(false)
    }
  }, [storeKey])

  // Esc to close + click-outside.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  function gotIt() {
    setOpen(false)
    setDismissed(true)
    try { localStorage.setItem(storeKey, '1') } catch { /* private mode — fine */ }
  }

  return (
    <span ref={popRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={domId}
        aria-label={title ? `Explain: ${title}` : 'What is this?'}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors',
          // Pulse the affordance only for users who haven't dismissed it yet.
          mounted && !dismissed
            ? 'text-amber-300 hover:text-amber-200'
            : 'text-muted-foreground/50 hover:text-foreground',
        )}
      >
        <HelpCircle
          className={cn('h-3.5 w-3.5', mounted && !dismissed && 'animate-pulse-soft')}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={domId}
          role="dialog"
          className="absolute left-1/2 top-6 z-50 w-64 -translate-x-1/2 rounded-xl border border-amber-500/30 bg-card p-3 text-left shadow-card-lift glass-strong"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            {title && (
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                {title}
              </p>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>
          <button
            type="button"
            onClick={gotIt}
            className="mt-2.5 w-full rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300"
          >
            Got it — don&apos;t show the highlight again
          </button>
        </div>
      )}
    </span>
  )
}
