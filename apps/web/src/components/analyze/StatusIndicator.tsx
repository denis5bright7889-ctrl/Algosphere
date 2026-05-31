/**
 * StatusIndicator — direction pill on the IntelligenceCard header.
 *
 * V2 (Reliability layer): now also accepts `userStatus` to differentiate
 * Live / Degraded / Stale / Building states. The card no longer emits
 * "Awaiting" — that was the founder rule. Instead, an engine whose
 * direction is genuinely unavailable shows "Building" with an honest
 * tone, while stale-from-cache reads render the actual direction and
 * a separate "stale" affordance lives on the freshness pill.
 */
import { cn } from '@/lib/utils'
import type { ModuleStatus, UserStatus } from '@/lib/intelligence/grid-types'

const DIRECTION_MAP: Record<ModuleStatus, { label: string; cls: string; dot: string }> = {
  bullish:     { label: 'Bullish',  cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
  bearish:     { label: 'Bearish',  cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300',          dot: 'bg-rose-400' },
  neutral:     { label: 'Neutral',  cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',       dot: 'bg-amber-400' },
  unavailable: { label: 'Building', cls: 'border-border bg-muted/30 text-muted-foreground',          dot: 'bg-muted-foreground/60' },
}

export default function StatusIndicator({
  status, userStatus, className,
}: {
  status:      ModuleStatus
  /** Optional — when present we can refine the unavailable label. */
  userStatus?: UserStatus
  className?:  string
}) {
  // Refine the unavailable bucket: 'stale' reads still carry the actual
  // direction from the last successful poll, but a card we've never had
  // data for renders 'Building'. 'Fallback' (heuristic) keeps the
  // direction but flags the source quality elsewhere.
  const effective: ModuleStatus =
    status === 'unavailable' && userStatus === 'fallback' ? 'neutral' : status

  const s = DIRECTION_MAP[effective]
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
      s.cls, className,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  )
}
