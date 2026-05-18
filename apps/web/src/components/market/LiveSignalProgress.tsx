'use client'

import { Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickerForPair, cryptoLabelForPair } from './useCryptoTickers'

interface Props {
  pair: string | null | undefined
  direction: 'buy' | 'sell' | string
  entry: number | string | null | undefined
  sl: number | string | null | undefined
  tp1: number | string | null | undefined
}

function n(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : null
}

function fmt(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return p.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/**
 * Real-time progress strip for an active crypto signal.
 *
 * Renders ONLY when the signal's pair is a crypto symbol carried by
 * the active market source and entry/SL/TP1 are present. For FX/Gold
 * pairs or missing levels the component returns null — we do not
 * fabricate a price or a progress estimate.
 *
 * The bar shows SL ←—— Entry ——→ TP1, with a live marker for the
 * current mark price. Distance to the active target (TP1 if in
 * profit, SL if in drawdown) is shown numerically.
 */
export default function LiveSignalProgress({ pair, direction, entry, sl, tp1 }: Props) {
  // Always call the hook (rules of hooks); it returns null for non-crypto pairs.
  const ticker = useCryptoTickerForPair(pair)

  // Bail out gracefully — never invent values.
  if (!cryptoLabelForPair(pair)) return null
  const e = n(entry)
  const s = n(sl)
  const t = n(tp1)
  if (e == null || s == null || t == null) return null
  if (!ticker) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        Awaiting live mark price…
      </div>
    )
  }

  const isBuy = direction === 'buy'
  const price = ticker.price

  // Profit % toward TP1 vs drawdown % toward SL, signed against direction.
  const inProfit = isBuy ? price >= e : price <= e
  const targetGap = isBuy ? t - e : e - t
  const stopGap   = isBuy ? e - s : s - e
  const moveFromEntry = isBuy ? price - e : e - price

  const towardTpPct = targetGap > 0 ? Math.max(0, Math.min(1, moveFromEntry / targetGap)) : 0
  const towardSlPct = stopGap   > 0 ? Math.max(0, Math.min(1, -moveFromEntry / stopGap))  : 0

  // Marker position on the SL—Entry—TP1 axis (0 = SL, 0.5 = Entry, 1 = TP1).
  const marker =
    inProfit
      ? 0.5 + 0.5 * towardTpPct
      : 0.5 - 0.5 * towardSlPct

  const targetDelta = inProfit
    ? Math.abs(((t - price) / price) * 100)
    : Math.abs(((s - price) / price) * 100)
  const targetLabel = inProfit ? 'to TP1' : 'to SL'
  const toneCls = inProfit ? 'text-emerald-300' : 'text-rose-300'

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Radio
            className="h-2.5 w-2.5 animate-pulse-soft text-emerald-400"
            strokeWidth={2.5}
            aria-hidden
          />
          Mark
          <span className="ml-1 font-semibold text-foreground tabular-nums">${fmt(price)}</span>
        </span>
        <span className={cn('font-semibold tabular-nums', toneCls)}>
          {targetDelta.toFixed(2)}% {targetLabel}
        </span>
      </div>

      <div className="relative mt-1.5 h-1 rounded-full bg-muted/40">
        {/* Entry pivot marker at the midpoint */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-amber-400/60" aria-hidden />
        {/* Live mark marker */}
        <span
          className={cn(
            'absolute -top-0.5 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-background',
            inProfit ? 'bg-emerald-400' : 'bg-rose-400',
          )}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ left: `${marker * 100}%` }}
          aria-hidden
        />
      </div>

      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>SL ${fmt(s)}</span>
        <span>Entry ${fmt(e)}</span>
        <span>TP1 ${fmt(t)}</span>
      </div>
    </div>
  )
}
