'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart, ColorType, CrosshairMode,
  type IChartApi, type ISeriesApi, type CandlestickData, type SeriesMarker, type Time,
  type SeriesMarkerPosition, type SeriesMarkerShape,
} from 'lightweight-charts'
import { cn } from '@/lib/utils'

/**
 * Live Execution Mirror Chart — TradingView-style candles with the
 * user's actual fills overlaid as entry/exit markers. Polls
 * /api/execution/chart every POLL_MS; the chart instance is created
 * once and only the data/markers are updated (no flicker, no remount).
 *
 * Degrades gracefully: if the engine has no market-data provider the
 * bars come back empty and we render markers-only on a blank grid
 * with an honest "price feed unavailable" note.
 */

const POLL_MS = 10_000

interface ChartMarker {
  id:         string
  event_type: string
  time:       number
  side:       string
  price:      number | null
  qty:        number | null
  realized_pnl: number | null
  status:     string
}

interface ChartResponse {
  symbol:   string
  interval: string
  bars:     Array<{ time: number; open: number; high: number; low: number; close: number }>
  markers:  ChartMarker[]
  engine_configured: boolean
}

const SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'BTCUSD', 'ETHUSD', 'USDJPY']

export default function MirrorChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const [symbol, setSymbol]   = useState('XAUUSD')
  const [meta, setMeta]       = useState<{ markers: number; bars: number; engine: boolean }>({ markers: 0, bars: 0, engine: true })
  const [error, setError]     = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<string>('—')

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor:  '#9a9aa2',
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale:       { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: false },
      autoSize: true,
    })
    const series = chart.addCandlestickSeries({
      upColor: '#34d399', downColor: '#f43f5e',
      borderUpColor: '#34d399', borderDownColor: '#f43f5e',
      wickUpColor: '#34d399', wickDownColor: '#f43f5e',
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  // Poll data for the selected symbol.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function load() {
      try {
        const res = await fetch(`/api/execution/chart?symbol=${encodeURIComponent(symbol)}&interval=15min`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d: ChartResponse = await res.json()
        if (cancelled) return

        const series = seriesRef.current
        if (series) {
          if (d.bars.length > 0) {
            series.setData(d.bars as CandlestickData[])
          }
          // Entry = arrow below bar; exit = arrow above bar. Color by side.
          const markers: SeriesMarker<Time>[] = d.markers
            .filter((m) => m.time > 0)
            .map((m): SeriesMarker<Time> => {
              const isClose  = m.event_type === 'POSITION_CLOSED'
              const isReject = m.event_type === 'ORDER_REJECTED'
              const buy = m.side.toLowerCase() === 'buy'
              const position: SeriesMarkerPosition = isClose ? 'aboveBar' : 'belowBar'
              const shape: SeriesMarkerShape = isClose ? 'circle' : buy ? 'arrowUp' : 'arrowDown'
              return {
                time:     m.time as Time,
                position,
                color:    isReject ? '#f59e0b' : isClose ? '#a78bfa' : buy ? '#34d399' : '#f43f5e',
                shape,
                text:     isReject ? 'REJ'
                          : isClose ? (m.realized_pnl != null ? `${m.realized_pnl >= 0 ? '+' : ''}${m.realized_pnl.toFixed(2)}` : 'close')
                          : `${m.side.toUpperCase()}${m.price != null ? ' @' + m.price.toFixed(2) : ''}`,
              }
            })
            // lightweight-charts requires markers sorted ascending by time
            .sort((a, b) => (a.time as number) - (b.time as number))
          series.setMarkers(markers)
        }

        setMeta({ markers: d.markers.length, bars: d.bars.length, engine: d.engine_configured })
        setError(d.bars.length === 0 && d.engine_configured
          ? 'No price bars returned — the symbol may be unsupported by the data provider.'
          : (!d.engine_configured ? 'Engine has no market-data provider configured — markers shown on a blank grid.' : null))
        setLastUpdate(new Date().toLocaleTimeString())
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) timer = setTimeout(load, POLL_MS)
      }
    }

    load()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [symbol])

  return (
    <div className="card-premium p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold tracking-tight">Execution Mirror</h2>
          <span className="text-[10px] text-muted-foreground">live fills overlaid on price · refresh {POLL_MS / 1000}s</span>
        </div>
        <div className="flex items-center gap-1.5">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-mono transition-colors',
                symbol === s
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                  : 'border-border text-muted-foreground hover:border-amber-500/30',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="h-[420px] w-full rounded-lg overflow-hidden" />

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-2">
        <span>
          {meta.bars} bars · <span className="text-amber-300">{meta.markers}</span> execution markers · updated {lastUpdate}
        </span>
        {error && <span className="text-amber-400">⚠ {error}</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <Legend color="#34d399" label="Buy fill" />
        <Legend color="#f43f5e" label="Sell fill" />
        <Legend color="#a78bfa" label="Position closed (PnL)" />
        <Legend color="#f59e0b" label="Rejected" />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
