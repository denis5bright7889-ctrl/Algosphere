'use client'

/**
 * Fullscreen TradingView chart modal.
 *
 * Orchestrates: TradingView embed (left), AI/structure/signal/correlation
 * rail (right). Manages symbol + interval state, fetches per-symbol intel
 * with debounce, body scroll lock, ESC to close, portaled to document.body.
 *
 * Mobile: chart on top (fixed height), panels scroll below — TimeframeSwitcher
 * moves under the chart so the toolbar stays uncluttered. Desktop: classic
 * institutional terminal split with the rail on the right.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { toTradingViewSymbol, DEFAULT_INTERVAL, intervalLabel, ENGINE_TIMEFRAME_LABEL } from '@/lib/tradingview'
import type { AssetClass } from '@/lib/market-universe'
import type { ChartTarget } from './ChartModalProvider'
import type { SymbolIntel } from '@/lib/chart-intel'
import SymbolToolbar       from './SymbolToolbar'
import TimeframeSwitcher   from './TimeframeSwitcher'
import TradingViewEmbed    from './TradingViewEmbed'
import CryptoStreamChart   from './CryptoStreamChart'
import AIInsightPanel      from './AIInsightPanel'
import MarketMetricsPanel  from './MarketMetricsPanel'
import SignalOverlay       from './SignalOverlay'
import CorrelationPanel    from './CorrelationPanel'
import { CRYPTO_SYMBOLS } from '@/lib/binance'

// Symbols carried by the live market-stream → eligible for the canvas
// nChart renderer. Everything else uses the TradingView embed.
const STREAMABLE = new Set(CRYPTO_SYMBOLS.map((s) => s.symbol))

export default function TradingChartModal({
  target, onClose,
}: {
  target: ChartTarget | null
  onClose: () => void
}) {
  const [symbol, setSymbol]         = useState<string>('')
  const [assetClass, setAssetClass] = useState<AssetClass | undefined>(undefined)
  const [interval, setInterval]     = useState<string>(DEFAULT_INTERVAL)
  const [fullscreen, setFullscreen] = useState(false)
  const [chartMode, setChartMode]   = useState<'live' | 'advanced'>('live')
  const [intel, setIntel]           = useState<SymbolIntel | null>(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const fetchSeq = useRef(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Reset symbol whenever a new target is opened.
  useEffect(() => {
    if (target) { setSymbol(target.symbol); setAssetClass(target.assetClass) }
  }, [target])

  // Body scroll lock + global ESC while open.
  useEffect(() => {
    if (!target) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  // Debounced symbol-intel fetch (200ms).
  useEffect(() => {
    if (!symbol) return
    const seq = ++fetchSeq.current
    setIntelLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/market/intel/${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() as Promise<SymbolIntel> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((d) => { if (seq === fetchSeq.current) { setIntel(d); setIntelLoading(false) } })
        .catch(() => { if (seq === fetchSeq.current) { setIntel(null); setIntelLoading(false) } })
    }, 200)
    return () => clearTimeout(t)
  }, [symbol])

  const tvSymbol = useMemo(
    () => symbol ? toTradingViewSymbol(symbol, assetClass) : null,
    [symbol, assetClass],
  )

  if (!mounted || !target) return null

  const streamable = STREAMABLE.has(symbol)
  const showLive   = streamable && chartMode === 'live'
  const tfMismatch = !showLive && interval !== '60' && intel?.engine_timeframe === ENGINE_TIMEFRAME_LABEL

  const node = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Chart for ${symbol}`}
    >
      <div
        className={cn(
          'flex flex-col overflow-hidden border border-border/70 glass-strong shadow-glow animate-in slide-in-from-bottom-4 duration-200',
          fullscreen
            ? 'h-full w-full rounded-none'
            : 'h-[96vh] w-[98vw] max-w-[1600px] rounded-2xl sm:h-[92vh] md:inset-6',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <SymbolToolbar
          symbol={symbol}
          assetClass={assetClass}
          interval={interval}
          onSelectSymbol={(s, a) => { setSymbol(s); setAssetClass(a) }}
          onInterval={setInterval}
          onClose={onClose}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((v) => !v)}
        />

        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* Chart column */}
          <div className="flex flex-col bg-background/40 md:flex-1">
            {/* Signal ribbon — only when an accessible signal exists */}
            {intel?.signal.available && !intel.signal.locked && (
              <SignalRibbon
                direction={intel.signal.direction}
                entry={intel.signal.entry ?? null}
                stop={intel.signal.stop_loss ?? null}
                target={intel.signal.take_profit ?? null}
              />
            )}
            {tfMismatch && (
              <p className="border-b border-amber-500/20 bg-amber-500/5 px-3 py-1 text-[10px] text-amber-300/80">
                Chart on {intervalLabel(interval)} · engine intelligence below is computed on the {ENGINE_TIMEFRAME_LABEL} timeframe.
              </p>
            )}

            <div className="relative h-[55vh] min-h-[320px] md:h-auto md:min-h-0 md:flex-1">
              {/* Live / Advanced toggle — only shown for streamed crypto majors */}
              {streamable && (
                <div className="absolute left-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border/60 bg-card/80 p-0.5 backdrop-blur">
                  {(['live', 'advanced'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setChartMode(m)}
                      className={cn('rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
                        chartMode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                      {m === 'live' ? 'Live' : 'Adv'}
                    </button>
                  ))}
                </div>
              )}

              {showLive ? (
                <CryptoStreamChart symbol={symbol} />
              ) : tvSymbol ? (
                <TradingViewEmbed tvSymbol={tvSymbol} interval={interval} />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No TradingView feed for {symbol}. Try a different symbol from the search above.
                  </p>
                </div>
              )}
            </div>

            {/* Timeframe switcher under the chart on mobile — hidden in Live
                mode (the nChart carries its own 1m/5m/15m/1h selector). */}
            {!showLive && (
              <div className="border-t border-border/60 px-3 py-2 md:hidden">
                <TimeframeSwitcher interval={interval} onChange={setInterval} />
              </div>
            )}
          </div>

          {/* Intelligence rail */}
          <aside className="w-full shrink-0 overflow-y-auto border-t border-border/60 bg-card/20 p-3 md:w-[360px] md:border-l md:border-t-0 lg:w-[400px]">
            <div className="space-y-3">
              <AIInsightPanel     intel={intel} loading={intelLoading} />
              <MarketMetricsPanel intel={intel} loading={intelLoading} />
              <SignalOverlay      signal={intel?.signal ?? null} loading={intelLoading} />
              <CorrelationPanel   symbol={symbol} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}

function SignalRibbon({
  direction, entry, stop, target,
}: {
  direction?: string
  entry: number | null
  stop:  number | null
  target: number | null
}) {
  const buy = direction?.toLowerCase() === 'buy'
  const fmt = (n: number | null) =>
    n != null && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 5 }) : '—'
  return (
    <div className={cn(
      'flex items-center gap-3 border-b px-3 py-1.5 text-[11px]',
      buy ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-rose-500/20 bg-rose-500/5',
    )}>
      <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        buy ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/15 text-rose-300')}>
        {direction}
      </span>
      <span className="text-muted-foreground">Entry <span className="font-semibold text-foreground/90 tabular-nums">{fmt(entry)}</span></span>
      <span className="text-muted-foreground">Stop <span className="font-semibold text-rose-300 tabular-nums">{fmt(stop)}</span></span>
      <span className="text-muted-foreground">Target <span className="font-semibold text-emerald-300 tabular-nums">{fmt(target)}</span></span>
    </div>
  )
}
