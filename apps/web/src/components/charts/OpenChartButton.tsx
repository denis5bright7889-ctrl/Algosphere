'use client'

/**
 * Reusable "Open Chart" trigger. Drops into any server-rendered card to
 * summon the global TradingChartModal for the given symbol. Two visual
 * variants: a compact icon-only button for tight rows (table / mover row),
 * and a labelled pill for cards.
 */
import { LineChart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChartModal } from './ChartModalProvider'
import type { AssetClass } from '@/lib/market-universe'

export default function OpenChartButton({
  symbol, assetClass, variant = 'pill', className,
}: {
  symbol:     string
  assetClass?: AssetClass
  variant?:   'pill' | 'icon'
  className?: string
}) {
  const { openChart } = useChartModal()
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={() => openChart(symbol, assetClass)}
        aria-label={`Open chart for ${symbol}`}
        title={`Open chart · ${symbol}`}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300',
          className,
        )}
      >
        <LineChart className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openChart(symbol, assetClass)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300',
        className,
      )}
    >
      <LineChart className="h-3 w-3" strokeWidth={2} aria-hidden />
      Open Chart
    </button>
  )
}
