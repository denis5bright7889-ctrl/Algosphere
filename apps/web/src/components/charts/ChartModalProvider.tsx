'use client'

/**
 * Global chart-modal context. Mounted once in the dashboard layout so any
 * "Open Chart" button anywhere in the app can summon the TradingView modal
 * via the `useChartModal()` hook — no prop-threading through server pages.
 *
 * The heavy modal (TradingView embed + intel panels) is lazy-loaded with
 * next/dynamic and only mounted after the first open, keeping it out of the
 * initial dashboard bundle. A `window` event ('open-chart') is also honoured
 * as a fallback entry point (e.g. command palette).
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { AssetClass } from '@/lib/market-universe'

const TradingChartModal = dynamic(() => import('./TradingChartModal'), {
  ssr: false,
  loading: () => null,
})

export interface ChartTarget {
  symbol:     string
  assetClass?: AssetClass
}

interface ChartModalApi {
  openChart:  (symbol: string, assetClass?: AssetClass) => void
  closeChart: () => void
}

const Ctx = createContext<ChartModalApi | null>(null)

export function useChartModal(): ChartModalApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useChartModal must be used within <ChartModalProvider>')
  return c
}

export default function ChartModalProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ChartTarget | null>(null)
  const [loaded, setLoaded] = useState(false)

  const openChart = useCallback((symbol: string, assetClass?: AssetClass) => {
    setLoaded(true)
    setTarget({ symbol, assetClass })
  }, [])
  const closeChart = useCallback(() => setTarget(null), [])

  // Fallback entry point for non-hook callers.
  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<ChartTarget>).detail
      if (d?.symbol) { setLoaded(true); setTarget({ symbol: d.symbol, assetClass: d.assetClass }) }
    }
    window.addEventListener('open-chart', onOpen as EventListener)
    return () => window.removeEventListener('open-chart', onOpen as EventListener)
  }, [])

  return (
    <Ctx.Provider value={{ openChart, closeChart }}>
      {children}
      {loaded && <TradingChartModal target={target} onClose={closeChart} />}
    </Ctx.Provider>
  )
}
