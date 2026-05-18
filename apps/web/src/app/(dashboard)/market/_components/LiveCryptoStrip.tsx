'use client'

import { ArrowUp, ArrowDown, Radio, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickers, type StreamStatus } from './useCryptoTickers'

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}
function fmtVol(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

const STATUS: Record<StreamStatus, { cls: string; label: string; icon: typeof Radio }> = {
  live:         { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', label: 'LIVE',         icon: Radio },
  connecting:   { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',       label: 'CONNECTING',   icon: RefreshCw },
  reconnecting: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',       label: 'RECONNECTING', icon: RefreshCw },
  offline:      { cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300',          label: 'OFFLINE',      icon: WifiOff },
}

/**
 * Live crypto tape — REAL Binance public data (WS, REST-seeded).
 * Source is labelled; on disconnect it shows an honest status chip
 * and holds the last real values rather than inventing prices.
 */
export default function LiveCryptoStrip() {
  const { tickers, status, flash, updatedAt } = useCryptoTickers()
  const st = STATUS[status]
  const StatusIcon = st.icon

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Live Crypto
        </h2>
        <span
          title={updatedAt ? `Last update ${new Date(updatedAt).toLocaleTimeString()}` : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            st.cls,
          )}
        >
          <StatusIcon
            className={cn('h-3 w-3', status === 'live' && 'animate-pulse-soft',
              (status === 'connecting' || status === 'reconnecting') && 'animate-spin')}
            strokeWidth={2.25}
            aria-hidden
          />
          {st.label}
        </span>
      </div>

      {tickers.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          {status === 'offline'
            ? 'Exchange stream unavailable — no prices to show (we do not fabricate values).'
            : 'Connecting to Binance public stream…'}
        </p>
      ) : (
        <>
          {/* Mobile — stacked cards */}
          <ul className="grid grid-cols-2 gap-2 sm:hidden">
            {tickers.map((t) => {
              const up = t.changePct >= 0
              return (
                <li key={t.symbol} className="rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{t.label}</span>
                    <span className={cn('text-[11px] font-bold tabular-nums', up ? 'text-emerald-400' : 'text-rose-400')}>
                      {up ? '+' : ''}{t.changePct.toFixed(2)}%
                    </span>
                  </div>
                  <p key={t.price} className="mt-1 animate-fade-in text-sm font-semibold tabular-nums">
                    ${fmtPrice(t.price)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                    Vol {fmtVol(t.quoteVol)}
                  </p>
                </li>
              )
            })}
          </ul>

          {/* Desktop — dense table */}
          <div className="hidden overflow-hidden rounded-xl border border-border/60 sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Asset</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">24h</th>
                  <th className="px-4 py-2 text-right font-medium">24h High</th>
                  <th className="px-4 py-2 text-right font-medium">24h Low</th>
                  <th className="px-4 py-2 text-right font-medium">24h Vol</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map((t) => {
                  const up = t.changePct >= 0
                  const dir = flash[t.symbol]
                  return (
                    <tr key={t.symbol} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                      <td className="px-4 py-2.5 font-bold">{t.label}<span className="ml-1 text-[10px] font-normal text-muted-foreground">USDT</span></td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          key={t.price}
                          className={cn(
                            'inline-flex animate-fade-in items-center gap-1 tabular-nums font-semibold',
                            dir === 'up' ? 'text-emerald-400' : dir === 'down' ? 'text-rose-400' : 'text-foreground',
                          )}
                        >
                          {dir === 'up' && <ArrowUp className="h-3 w-3" strokeWidth={2.5} aria-hidden />}
                          {dir === 'down' && <ArrowDown className="h-3 w-3" strokeWidth={2.5} aria-hidden />}
                          ${fmtPrice(t.price)}
                        </span>
                      </td>
                      <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', up ? 'text-emerald-400' : 'text-rose-400')}>
                        {up ? '+' : ''}{t.changePct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">${fmtPrice(t.high)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">${fmtPrice(t.low)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtVol(t.quoteVol)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Source: <span className="font-mono">Binance</span> public market data · real exchange feed,
        not financial advice.
      </p>
    </section>
  )
}
