'use client'

/**
 * Single chart cell in the workspace grid.
 *
 * Hosts a lazily-mounted TradingView widget plus a slim toolbar:
 * symbol search (reuses the registry-backed SymbolSearch from /charts),
 * timeframe switcher, compare overlay picker, theater toggle, and an
 * "active panel" affordance (the AI rail follows the active panel).
 *
 * Honest behaviour: when the resolved TradingView symbol is null
 * (catalogued-only instrument), we render the registry headline and a
 * clear "Chart unavailable for this instrument" message instead of an
 * empty iframe.
 */
import { Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import TradingViewEmbed from '@/components/charts/TradingViewEmbed'
import SymbolSearch     from '@/components/charts/SymbolSearch'
import TimeframeSwitcher from '@/components/charts/TimeframeSwitcher'
import { useWorkspace } from './WorkspaceProvider'
import ComparePicker    from './ComparePicker'
import type { ChartPanelState } from '@/lib/workspace-store'
import { toTradingViewSymbol } from '@/lib/tradingview'
import { symbolByCode } from '@/lib/symbol-registry'

export default function ChartPanel({
  panel, theaterPanelId, onToggleTheater,
}: {
  panel: ChartPanelState
  theaterPanelId: string | null
  onToggleTheater: (id: string) => void
}) {
  const ws = useWorkspace()
  const isActive  = ws.activeTab.activePanelId === panel.id
  const isTheater = theaterPanelId === panel.id

  const tvSymbol = toTradingViewSymbol(panel.symbol, panel.assetClass)
  const compareTv = panel.compareWith
    .map((s) => toTradingViewSymbol(s, symbolByCode(s)?.asset_class))
    .filter((s): s is string => !!s)

  return (
    <section
      onClick={() => !isActive && ws.setActivePanel(panel.id)}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background/40 transition-colors',
        isActive ? 'border-amber-500/40' : 'border-border/60',
      )}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1.5">
        <SymbolSearch
          current={panel.symbol}
          onSelect={(s, ac) => { ws.setPanelSymbol(panel.id, s, ac); ws.pushRecent(s) }}
        />
        <TimeframeSwitcher
          interval={panel.interval}
          onChange={(i) => ws.setPanelInterval(panel.id, i)}
        />
        <ComparePicker panel={panel} />
        <button type="button"
                onClick={(e) => { e.stopPropagation(); onToggleTheater(panel.id) }}
                aria-label={isTheater ? 'Exit theater' : 'Theater mode'}
                title={isTheater ? 'Exit theater' : 'Theater mode'}
                className="ml-auto rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground">
          {isTheater
            ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
        </button>
      </div>

      {/* Chart body */}
      <div className="relative min-h-0 flex-1">
        {tvSymbol ? (
          <TradingViewEmbed tvSymbol={tvSymbol} interval={panel.interval} compareSymbols={compareTv} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-6 text-center">
            <p className="text-sm font-semibold">{panel.symbol}</p>
            <p className="text-xs text-muted-foreground">Chart unavailable for this instrument.</p>
          </div>
        )}
      </div>
    </section>
  )
}
