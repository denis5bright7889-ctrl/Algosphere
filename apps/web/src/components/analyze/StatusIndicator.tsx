/**
 * StatusIndicator — the bull/bear/neutral status pill for an
 * IntelligenceCard header. Pure presentation; colour encodes direction.
 */
import { cn } from '@/lib/utils'
import type { ModuleStatus } from '@/lib/intelligence/grid-types'

const MAP: Record<ModuleStatus, { label: string; cls: string; dot: string }> = {
  bullish:     { label: 'Bullish',  cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
  bearish:     { label: 'Bearish',  cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300',          dot: 'bg-rose-400' },
  neutral:     { label: 'Neutral',  cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',       dot: 'bg-amber-400' },
  unavailable: { label: 'Awaiting', cls: 'border-border bg-muted/30 text-muted-foreground',          dot: 'bg-muted-foreground/60' },
}

export default function StatusIndicator({ status, className }: {
  status: ModuleStatus; className?: string
}) {
  const s = MAP[status]
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
