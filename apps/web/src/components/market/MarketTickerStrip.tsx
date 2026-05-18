'use client'

import { ArrowUp, ArrowDown, Radio, RefreshCw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickers, type StreamStatus } from './useCryptoTickers'

/**
 * Slim real-price tape for unauthenticated surfaces (marketing
 * landing). Reuses the dashboard hook so the marketing visitor and
 * the logged-in user see the *same* genuinely live data from the
 * same multi-source pipeline. No fabrication: when the exchange is
 * unreachable the strip says so honestly.
 *
 * Compact by design — one horizontal row, never more than ~80px
 * tall, doesn't compete with the hero. Mobile: horizontal scroll.
 */

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1)    return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

const STATUS_CLS: Record<StreamStatus, { cls: string; label: string; icon: typeof Radio }> = {
  live:         { cls: 'text-emerald-300',                      label: 'LIVE',         icon: Radio },
  connecting:   { cls: 'text-amber-300',                        label: 'CONNECTING',   icon: RefreshCw },
  reconnecting: { cls: 'text-amber-300',                        label: 'RECONNECTING', icon: RefreshCw },
  offline:      { cls: 'text-rose-300',                         label: 'STREAM OFFLINE', icon: WifiOff },
}

export default function MarketTickerStrip() {
  const { tickers, status, flash, sourceLabel } = useCryptoTickers()
  const st = STATUS_CLS[status]
  const StatusIcon = st.icon

  return (
    <section className="border-y border-border/60 bg-background/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <span className={cn('hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] shrink-0', st.cls)}>
          <StatusIcon
            className={cn(
              'h-3 w-3',
              status === 'live' && 'animate-pulse-soft',
              (status === 'connecting' || status === 'reconnecting') && 'animate-spin',
            )}
            strokeWidth={2.25}
            aria-hidden
          />
          {st.label}
        </span>

        <ul className="flex flex-1 items-center gap-4 overflow-x-auto sm:gap-5">
          {tickers.length === 0 ? (
            <li className="text-[11px] text-muted-foreground">
              {status === 'offline'
                ? 'Exchange stream unavailable — no prices to show.'
                : 'Connecting to live exchange…'}
            </li>
          ) : (
            tickers.map((t) => {
              const up = t.changePct >= 0
              const dir = flash[t.symbol]
              return (
                <li key={t.symbol} className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                  <span className="text-[11px] font-bold text-foreground/90">{t.label}</span>
                  <span
                    key={t.price}
                    className={cn(
                      'inline-flex animate-fade-in items-center gap-0.5 text-[11px] font-semibold',
                      dir === 'up' ? 'text-emerald-300' : dir === 'down' ? 'text-rose-300' : 'text-foreground',
                    )}
                  >
                    {dir === 'up' && <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />}
                    {dir === 'down' && <ArrowDown className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />}
                    ${fmtPrice(t.price)}
                  </span>
                  <span className={cn('text-[10px] font-medium', up ? 'text-emerald-400' : 'text-rose-400')}>
                    {up ? '+' : ''}{t.changePct.toFixed(2)}%
                  </span>
                </li>
              )
            })
          )}
        </ul>

        <span className="hidden lg:inline text-[10px] text-muted-foreground shrink-0">
          {sourceLabel ?? '—'}
        </span>
      </div>
    </section>
  )
}
