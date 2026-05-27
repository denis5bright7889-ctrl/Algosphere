'use client'

/**
 * Workspace AI rail. Mirrors the chart-modal rail (#41) but follows the
 * workspace's active panel — switching panel updates the rail. Reuses
 * the exact panel components so the institutional read is identical
 * across the modal "quick look" and the workspace.
 */
import { useEffect, useRef, useState } from 'react'
import AIInsightPanel     from '@/components/charts/AIInsightPanel'
import MarketMetricsPanel from '@/components/charts/MarketMetricsPanel'
import SignalOverlay      from '@/components/charts/SignalOverlay'
import CorrelationPanel   from '@/components/charts/CorrelationPanel'
import { useWorkspace } from './WorkspaceProvider'
import type { SymbolIntel } from '@/lib/chart-intel'
import { ENGINE_TIMEFRAME_LABEL, intervalLabel } from '@/lib/tradingview'

export default function WorkspaceAIRail() {
  const ws = useWorkspace()
  const symbol   = ws.activePanel.symbol
  const interval = ws.activePanel.interval
  const [intel, setIntel] = useState<SymbolIntel | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  // Debounced intel fetch on symbol change (same shape as the modal).
  useEffect(() => {
    if (!symbol) return
    const my = ++seq.current
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/market/intel/${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() as Promise<SymbolIntel> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((d) => { if (my === seq.current) { setIntel(d); setLoading(false) } })
        .catch(() => { if (my === seq.current) { setIntel(null); setLoading(false) } })
    }, 200)
    return () => clearTimeout(t)
  }, [symbol])

  const tfMismatch = interval !== '60' && intel?.engine_timeframe === ENGINE_TIMEFRAME_LABEL

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-border/60 bg-card/20 p-2.5">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Intel · {symbol}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          chart {intervalLabel(interval)}{tfMismatch ? ` · engine ${ENGINE_TIMEFRAME_LABEL}` : ''}
        </span>
      </header>

      {tfMismatch && (
        <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-300/80">
          Engine regime available only on the {ENGINE_TIMEFRAME_LABEL} timeframe — read below is computed on {ENGINE_TIMEFRAME_LABEL}, not the chart&apos;s {intervalLabel(interval)}.
        </p>
      )}

      <div className="space-y-2.5">
        <AIInsightPanel     intel={intel} loading={loading} />
        <MarketMetricsPanel intel={intel} loading={loading} />
        <SignalOverlay      signal={intel?.signal ?? null} loading={loading} />
        <CorrelationPanel   symbol={symbol} />
      </div>
    </aside>
  )
}
