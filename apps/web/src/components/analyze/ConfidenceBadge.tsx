/**
 * ConfidenceBadge — compact 0–100 confidence read for a card header.
 * Monospace metric (institutional convention). Tone tracks magnitude,
 * not direction (direction lives in StatusIndicator).
 */
import { cn } from '@/lib/utils'

export default function ConfidenceBadge({ value, available = true, className }: {
  value: number; available?: boolean; className?: string
}) {
  if (!available) {
    return (
      <span className={cn('font-mono text-[11px] tabular-nums text-muted-foreground', className)}>
        —
      </span>
    )
  }
  const tone =
    value >= 65 ? 'text-emerald-300'
    : value >= 45 ? 'text-amber-300'
    : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex items-baseline gap-0.5 font-mono tabular-nums', className)}>
      <span className={cn('text-sm font-bold', tone)}>{Math.round(value)}</span>
      <span className="text-[9px] text-muted-foreground">%</span>
    </span>
  )
}
