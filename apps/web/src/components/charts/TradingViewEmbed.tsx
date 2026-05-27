'use client'

/**
 * TradingView Advanced Chart widget wrapper.
 *
 * Loads tv.js once (module-level promise, shared across opens) and
 * (re)instantiates the widget whenever the TradingView symbol or interval
 * changes. Dark institutional theme, candles, drawing tools + indicators
 * enabled, autosize so it fills its container on resize.
 *
 * Renders a skeleton while the script/widget initialise and a graceful
 * "open on TradingView" fallback if the script fails to load (e.g. blocked
 * network). No API key required — the widget serves TradingView's own data.
 */
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'

declare global {
  interface Window {
    TradingView?: { widget: new (config: Record<string, unknown>) => unknown }
  }
}

const TV_SRC = 'https://s3.tradingview.com/tv.js'
let scriptPromise: Promise<void> | null = null

function loadTv(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.TradingView) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = TV_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { scriptPromise = null; reject(new Error('Failed to load TradingView')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export default function TradingViewEmbed({
  tvSymbol, interval,
}: {
  tvSymbol: string
  interval: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(`tv_${Math.random().toString(36).slice(2)}`)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    loadTv()
      .then(() => {
        if (cancelled || !window.TradingView || !containerRef.current) return
        containerRef.current.innerHTML = ''
        new window.TradingView.widget({
          container_id:       idRef.current,
          symbol:             tvSymbol,
          interval,
          autosize:           true,
          theme:              'dark',
          style:              '1',          // candles
          timezone:           'Etc/UTC',
          locale:             'en',
          toolbar_bg:         'rgba(0,0,0,0)',
          enable_publishing:  false,
          allow_symbol_change: false,        // we drive symbol switching ourselves
          hide_side_toolbar:  false,         // keep drawing tools
          withdateranges:     true,
          details:            false,
          studies:            [],
        })
        // The simple embed exposes no ready callback; reveal after a beat.
        const t = setTimeout(() => { if (!cancelled) setStatus('ready') }, 600)
        return () => clearTimeout(t)
      })
      .catch(() => { if (!cancelled) setStatus('error') })

    return () => { cancelled = true }
  }, [tvSymbol, interval])

  if (status === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Chart failed to load.</p>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
          target="_blank" rel="noopener noreferrer"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-amber-300 hover:border-amber-500/40"
        >
          Open {tvSymbol} on TradingView ↗
        </a>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {status === 'loading' && (
        <div className="absolute inset-0 z-10 p-4">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      )}
      <div id={idRef.current} ref={containerRef} className="h-full w-full" />
    </div>
  )
}
