'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  getMarketSession, fmtCountdown, type MarketSession, type SessionName,
} from '@/lib/market-session'

/**
 * Session Intelligence (homepage block #6 from the UX brief).
 *
 * Surfaces the *real* FX/Gold trading-session state from the UTC
 * clock — the same authoritative source behind LiveMarketPill — as a
 * first-class intelligence panel instead of a 2px dot. No feed, no
 * fabrication: the Fri 22:00 → Sun 22:00 UTC weekend close is exact,
 * session bands are the conventional UTC windows (indicative, as the
 * panel states). Re-ticks each minute.
 */
const ALL: SessionName[] = ['Sydney', 'Tokyo', 'London', 'New York']

export default function SessionIntelligence() {
  const [s, setS] = useState<MarketSession>(() => getMarketSession())

  useEffect(() => {
    const tick = () => setS(getMarketSession())
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const open = s.open

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
            open
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
          )}
        >
          <span className="relative flex h-1.5 w-1.5">
            {open && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', open ? 'bg-emerald-400' : 'bg-amber-400')} />
          </span>
          {open ? 'Market Open' : 'Weekend Close'}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {open
            ? `Closes in ${fmtCountdown(s.msToFlip)}`
            : `Opens in ${fmtCountdown(s.msToFlip)}`}
        </span>
      </div>

      {/* Active-session ribbon — only meaningful while open. */}
      {open ? (
        <>
          <div className="flex gap-1.5">
            {ALL.map((name) => {
              const live = s.active.includes(name)
              return (
                <div
                  key={name}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 text-center transition-colors',
                    live
                      ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                      : 'border-border/60 bg-muted/10',
                  )}
                >
                  <p className={cn(
                    'text-[10px] font-semibold',
                    live ? 'text-emerald-300' : 'text-muted-foreground/70',
                  )}>
                    {name}
                  </p>
                  <p className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">
                    {live ? 'live' : 'closed'}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {s.primary
              ? <>Primary liquidity: <span className="font-semibold text-foreground">{s.primary}</span>{s.active.length > 1 && <> · {s.label} overlap</>}.</>
              : 'Between sessions — thin liquidity, wider spreads likely.'}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Spot FX/Gold is closed for the weekend. Crypto trades 24/7 — see the live
          tape on <a href="/market" className="text-amber-300 hover:underline">Market Tracker</a>.
        </p>
      )}

      <p className="text-[9px] text-muted-foreground/70">
        Session windows are conventional UTC bands (indicative; real edges shift ±1h
        with regional DST). Open/closed state is authoritative.
      </p>
    </div>
  )
}
