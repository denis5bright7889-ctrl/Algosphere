'use client'

import { useMemo } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickers } from '@/components/market/useCryptoTickers'

/**
 * "Major Market Movers" — homepage block from the UX brief.
 *
 * Real top gainers / losers from the shared Binance→Coinbase ticker
 * singleton (zero extra sockets). Honest about scope: this is the
 * live CRYPTO universe only. Forex / stocks / futures movers stay
 * absent (not faked) until those feeds are credentialed — the footer
 * says so plainly. Status + source reflect the true stream state.
 */
function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export default function MarketMovers() {
  const { tickers, status, sourceLabel } = useCryptoTickers()

  const { gainers, losers } = useMemo(() => {
    const withMove = tickers.filter((t) => Number.isFinite(t.changePct))
    const sorted = [...withMove].sort((a, b) => b.changePct - a.changePct)
    return {
      gainers: sorted.filter((t) => t.changePct > 0).slice(0, 3),
      losers: sorted.filter((t) => t.changePct < 0).slice(-3).reverse(),
    }
  }, [tickers])

  if (tickers.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {status === 'offline'
          ? 'Exchange stream unavailable — no movers to show (we never fabricate prices).'
          : 'Connecting to the live exchange…'}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <Side title="Top Gainers" rows={gainers} dir="up" />
      <Side title="Top Losers"  rows={losers}  dir="down" />
      <p className="text-[9px] text-muted-foreground/70">
        Source: <span className="font-mono">{sourceLabel ?? '—'}</span> · live crypto
        universe only. Forex / stock / futures movers activate when those market feeds
        are connected — they are not shown rather than faked.
      </p>
    </div>
  )
}

function Side({
  title, rows, dir,
}: {
  title: string
  rows: { symbol: string; label: string; price: number; changePct: number }[]
  dir: 'up' | 'down'
}) {
  const Icon = dir === 'up' ? ArrowUp : ArrowDown
  const tone = dir === 'up' ? 'text-emerald-400' : 'text-rose-400'
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-3 w-3', tone)} strokeWidth={2.5} aria-hidden />
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">
          {dir === 'up' ? 'No gainers right now.' : 'No losers right now.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((t) => (
            <li key={t.symbol} className="flex items-center justify-between text-xs tabular-nums">
              <span className="font-semibold text-foreground/90">{t.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">${fmtPrice(t.price)}</span>
                <span className={cn('w-16 text-right font-bold', tone)}>
                  {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(2)}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
