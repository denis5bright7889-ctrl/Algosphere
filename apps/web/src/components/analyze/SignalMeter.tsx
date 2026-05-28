/**
 * SignalMeter — the card's micro-visualization (a bipolar lean/heat bar).
 *
 * The Decision Brain gives each engine a point-in-time directional vote
 * (`lean` ∈ [-1,+1]) and a `strength` ∈ [0,1] — NOT a time series. So we
 * render an honest bipolar meter rather than fabricate a sparkline: a
 * centre zero line, a fill growing left (bearish/rose) or right
 * (bullish/emerald) proportional to |lean|, its opacity scaled by
 * strength. Risk-only engines (no lean) show a neutral strength strip.
 */
import { cn } from '@/lib/utils'

export default function SignalMeter({
  lean, strength, directional, available, className,
}: {
  lean: number; strength: number; directional: boolean; available: boolean; className?: string
}) {
  if (!available) {
    return <div className={cn('h-1.5 w-full rounded-full bg-muted/30', className)} aria-hidden />
  }

  // Risk-only engines (volatility / execution): single-ended strength strip.
  if (!directional) {
    return (
      <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted/30', className)} aria-hidden>
        <div className="h-full rounded-full bg-sky-400/70" style={{ width: `${Math.round(strength * 100)}%` }} />
      </div>
    )
  }

  const pct = Math.min(100, Math.abs(lean) * 100)
  const bullish = lean >= 0
  const opacity = 0.35 + Math.min(0.65, strength)   // strength → intensity

  return (
    <div className={cn('relative h-1.5 w-full rounded-full bg-muted/30', className)} aria-hidden>
      {/* centre zero line */}
      <div className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-border" />
      {/* directional fill from centre */}
      <div
        className={cn('absolute top-0 h-full rounded-full', bullish ? 'bg-emerald-400' : 'bg-rose-400')}
        style={{
          left: bullish ? '50%' : undefined,
          right: bullish ? undefined : '50%',
          width: `${pct / 2}%`,
          opacity,
        }}
      />
    </div>
  )
}
