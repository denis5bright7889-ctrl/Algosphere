'use client'

/**
 * Chart-modal top bar: symbol switcher + asset-class chip, timeframe
 * switcher, fullscreen toggle, and close. Keyboard-accessible buttons;
 * the symbol switcher and timeframe switcher own their own state UIs.
 */
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { AssetClass } from '@/lib/market-universe'
import SymbolSearch from './SymbolSearch'
import TimeframeSwitcher from './TimeframeSwitcher'

const ASSET_LABEL: Record<AssetClass, string> = {
  crypto: 'Crypto', forex: 'Forex', gold: 'Metals', indices: 'Indices',
  stocks: 'Stocks', commodities: 'Commodities', futures: 'Futures',
  bonds: 'Bonds', volatility: 'Volatility',
}

export default function SymbolToolbar({
  symbol, assetClass, interval,
  onSelectSymbol, onInterval, onClose, fullscreen, onToggleFullscreen,
}: {
  symbol:     string
  assetClass?: AssetClass
  interval:   string
  onSelectSymbol: (symbol: string, assetClass: AssetClass) => void
  onInterval: (interval: string) => void
  onClose:    () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
      <SymbolSearch current={symbol} onSelect={onSelectSymbol} />
      {assetClass && (
        <span className="hidden rounded-md border border-border/60 bg-muted/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
          {ASSET_LABEL[assetClass]}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:block">
          <TimeframeSwitcher interval={interval} onChange={onInterval} />
        </div>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="hidden rounded-lg border border-border/60 p-2 text-muted-foreground transition-colors hover:text-foreground sm:block"
        >
          {fullscreen
            ? <Minimize2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            : <Maximize2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chart"
          className="rounded-lg border border-border/60 p-2 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
        >
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  )
}
