'use client'

/**
 * ExpandDrawer — the right-side breakdown for an IntelligenceCard.
 *
 * Opens IN PLACE (no page navigation — Analyze Mode rule). Shows the full
 * signal read: status, confidence, the directional lean, the engine's own
 * reasoning note, and the data timestamp. Slides in via CSS transition
 * (respects prefers-reduced-motion through globals.css). Closes on
 * backdrop click, the X, or Escape.
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IntelligenceModule } from '@/lib/intelligence/grid-types'
import StatusIndicator from './StatusIndicator'
import SignalMeter from './SignalMeter'
import SourceQualityPill from './SourceQualityPill'
import FreshnessPill from './FreshnessPill'

export default function ExpandDrawer({ module, onClose }: {
  module: IntelligenceModule | null
  onClose: () => void
}) {
  // Escape to close.
  useEffect(() => {
    if (!module) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [module, onClose])

  const open = module !== null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={module ? `${module.name} breakdown` : undefined}
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border/70 bg-card shadow-2xl',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {module && (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight">{module.name}</h2>
                <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Decision-Brain engine · {module.key}
                </p>
              </div>
              <button
                type="button" onClick={onClose} aria-label="Close"
                className="rounded-lg border border-border/60 p-2 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
              >
                <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>

            {/* Status + confidence */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/10 p-3">
              <StatusIndicator status={module.status} userStatus={module.userStatus} />
              <span className="font-mono text-sm tabular-nums">
                {module.userStatus === 'building' ? '—' : `${module.confidence}% confidence`}
              </span>
            </div>

            {/* Source + freshness affordances — same vocabulary as the card */}
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceQualityPill quality={module.source_quality} />
              <FreshnessPill freshness={module.freshness} userStatus={module.userStatus} />
            </div>

            {/* Directional lean */}
            {module.directional && module.userStatus !== 'building' && (
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Directional lean</p>
                <SignalMeter lean={module.lean} strength={module.confidence / 100} directional available />
                <p className="mt-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {module.lean >= 0 ? '+' : ''}{module.lean.toFixed(2)} on a −1…+1 scale
                </p>
              </div>
            )}

            {/* Sanitized reasoning — never the raw `insight` here either */}
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Reasoning</p>
              <p className="rounded-xl border border-border/60 bg-muted/10 p-3 text-sm leading-relaxed">
                {module.reasoning}
              </p>
            </div>

            {/* Meta */}
            <div className="border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
              <p>
                {module.userStatus === 'stale'
                  ? `Last successful read ${module.freshness}.`
                  : module.userStatus === 'building'
                  ? 'Warming up — this engine has not produced data yet.'
                  : `Updated ${module.freshness} (${new Date(module.updatedAt).toLocaleString()}).`}
              </p>
              {!module.directional && (
                <p className="mt-1">Risk-only engine — contributes to risk &amp; sizing, not the directional vote.</p>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
