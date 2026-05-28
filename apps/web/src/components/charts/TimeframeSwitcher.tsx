'use client'

import { TIMEFRAMES } from '@/lib/tradingview'
import { cn } from '@/lib/utils'

/** Compact 1m → 1W interval selector. Drives the chart (and the panel
 *  header note when the selected TF differs from the engine read). */
export default function TimeframeSwitcher({
  interval, onChange,
}: {
  interval: string
  onChange: (interval: string) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/40 p-0.5">
      {TIMEFRAMES.map((tf) => {
        const on = tf.interval === interval
        return (
          <button
            key={tf.interval}
            type="button"
            onClick={() => onChange(tf.interval)}
            aria-pressed={on}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums transition-colors',
              on ? 'bg-gradient-primary text-black shadow-glow-gold'
                 : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}
          >
            {tf.label}
          </button>
        )
      })}
    </div>
  )
}
