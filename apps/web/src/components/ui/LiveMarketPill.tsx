'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { getMarketSession, fmtCountdown, type MarketSession } from '@/lib/market-session'

interface Props {
  /** Mobile-tight rendering — short label, same truthful state. */
  compact?: boolean
  className?: string
}

const SHORT: Record<string, string> = {
  Sydney: 'SYD', Tokyo: 'TYO', London: 'LDN', 'New York': 'NY',
}

/**
 * Real FX/Gold market-session indicator.
 *
 * No fabricated "LIVE" — the dot is emerald only while the spot
 * market is actually trading, and amber over the weekend close with
 * a truthful countdown to the Sunday 22:00 UTC reopen. State is
 * derived from the UTC clock (see lib/market-session) and re-ticks
 * each minute; no feed or API key involved.
 */
export default function LiveMarketPill({ compact = false, className }: Props) {
  const [s, setS] = useState<MarketSession>(() => getMarketSession())

  useEffect(() => {
    const tick = () => setS(getMarketSession())
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const open = s.open
  const full = open
    ? s.primary
      ? `${s.primary.toUpperCase()} SESSION`
      : 'MARKET OPEN'
    : `CLOSED · OPENS ${fmtCountdown(s.msToFlip)}`
  const short = open ? (s.primary ? SHORT[s.primary] ?? 'OPEN' : 'OPEN') : 'CLOSED'
  const title = open
    ? `FX/Gold market open — ${s.label} (UTC). Closes in ${fmtCountdown(s.msToFlip)}.`
    : `FX/Gold market closed for the weekend. Reopens Sunday 22:00 UTC (in ${fmtCountdown(s.msToFlip)}).`

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold tracking-[0.18em] uppercase tabular-nums',
        open
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        className,
      )}
    >
      <span className="relative flex h-2 w-2">
        {open && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            open ? 'bg-emerald-400' : 'bg-amber-400',
          )}
        />
      </span>
      <span suppressHydrationWarning>{compact ? short : full}</span>
    </span>
  )
}
