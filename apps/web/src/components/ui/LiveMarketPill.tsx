import { cn } from '@/lib/utils'

interface Props {
  label?:    string
  active?:   boolean
  className?: string
}

/**
 * "● LIVE MARKET" indicator for hero headers.
 * Server-render friendly — pure CSS animation, no JS state.
 */
export default function LiveMarketPill({
  label    = 'LIVE MARKET',
  active   = true,
  className,
}: Props) {
  return (
    <span className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold tracking-[0.18em] uppercase',
      active
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      className,
    )}>
      <span className="relative flex h-2 w-2">
        <span className={cn(
          'absolute inline-flex h-full w-full rounded-full opacity-75',
          active && 'animate-ping bg-emerald-400',
          !active && 'bg-amber-400',
        )} />
        <span className={cn(
          'relative inline-flex h-2 w-2 rounded-full',
          active ? 'bg-emerald-400' : 'bg-amber-400',
        )} />
      </span>
      {label}
    </span>
  )
}
