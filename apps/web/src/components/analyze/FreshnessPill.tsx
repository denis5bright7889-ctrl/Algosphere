/**
 * FreshnessPill — "updated 12m ago" badge on the IntelligenceCard.
 *
 * V2 (Reliability layer): also encodes user-status so a 'stale' read
 * gets a different visual tone than a fresh one. Cards never go blank;
 * if the engine has never produced data we show "building" instead of
 * a fake timestamp.
 */
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserStatus } from '@/lib/intelligence/grid-types'

export default function FreshnessPill({
  freshness, userStatus, className,
}: {
  freshness: string
  userStatus: UserStatus
  className?: string
}) {
  // Building / fallback never carry "updated N ago"; they carry an
  // honest "warming up" / "internal" label.
  let label = freshness
  let tone = 'border-border bg-background/40 text-muted-foreground'
  let hint = `Updated ${freshness}`
  if (userStatus === 'building') {
    label = 'warming up'
    tone  = 'border-border bg-muted/30 text-muted-foreground/80'
    hint  = 'This engine has not produced data yet — recalibrating.'
  } else if (userStatus === 'stale') {
    label = `cached · ${freshness}`
    tone  = 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300/90'
    hint  = `Live source did not return on this cycle. Serving the last successful read from ${freshness}.`
  } else if (userStatus === 'fallback') {
    label = 'internal model'
    tone  = 'border-border bg-muted/30 text-muted-foreground/80'
    hint  = 'No external data this cycle. Internal heuristic model produced this read.'
  } else if (userStatus === 'degraded') {
    label = `${freshness} · fallback source`
    tone  = 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300/90'
    hint  = `Live data via a fallback source. Updated ${freshness}.`
  }

  return (
    <span
      title={hint}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium tracking-wide',
        tone, className,
      )}
    >
      <Clock className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden />
      {label}
    </span>
  )
}
