/**
 * SourceQualityPill — micro-badge on the IntelligenceCard footer.
 *
 * Tells the user how much weight to give the read:
 *   high   → primary-source, high-confidence
 *   medium → primary-source, lower confidence OR live secondary source
 *   low    → ageing / partial / approaching TTL
 *   fallback → internal heuristic only (no external data)
 *
 * Per the founder rule the card must NEVER expose provider names. This
 * is the only public signal that the platform "knows" how good the
 * underlying data is.
 */
import { cn } from '@/lib/utils'
import type { SourceQuality } from '@/lib/intelligence/grid-types'

const MAP: Record<SourceQuality, { label: string; cls: string; hint: string }> = {
  high:     { label: 'High',     cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', hint: 'Primary-source, high confidence' },
  medium:   { label: 'Medium',   cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',       hint: 'Lower-confidence read or live secondary source' },
  low:      { label: 'Low',      cls: 'border-orange-500/40 bg-orange-500/10 text-orange-300',    hint: 'Ageing or partial — handle with care' },
  fallback: { label: 'Fallback', cls: 'border-border bg-muted/30 text-muted-foreground',           hint: 'Internal heuristic — no external data this cycle' },
}

export default function SourceQualityPill({
  quality, className,
}: {
  quality: SourceQuality
  className?: string
}) {
  const s = MAP[quality]
  return (
    <span
      title={s.hint}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
        s.cls, className,
      )}
    >
      Source · {s.label}
    </span>
  )
}
