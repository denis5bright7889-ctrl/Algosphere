'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Ticker } from '@/lib/binance'
import { binanceSource } from '@/lib/binance'
import { coinbaseSource } from '@/lib/coinbase'
import type { MarketSource, SourceName } from '@/lib/market-source'

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

interface State {
  tickers: Ticker[]
  status: StreamStatus
  /** Per-symbol last tick direction — drives the price flash. */
  flash: Record<string, 'up' | 'down' | undefined>
  /** ISO of the last accepted update. */
  updatedAt: string | null
  /** Exchange currently providing the stream, or null if offline. */
  source: SourceName | null
  /** Human label for the source footer. */
  sourceLabel: string | null
}

/**
 * Priority order: Binance first (richer symbol set incl. BNB + PAXG),
 * Coinbase Exchange as a US-legal fallback when Binance.com is
 * geoblocked. Order matters — each is tried only after the previous
 * fails to seed a REST snapshot.
 */
const SOURCES: MarketSource[] = [binanceSource, coinbaseSource]

const STALE_MS = 60_000
const MAX_BACKOFF = 20_000
const REST_TIMEOUT_MS = 4_000
/** Bail out of a source after this many consecutive WS reconnect failures. */
const WS_FAIL_LIMIT = 3

export function useCryptoTickers() {
  const [s, setS] = useState<State>({
    tickers: [], status: 'connecting', flash: {},
    updatedAt: null, source: null, sourceLabel: null,
  })

  const sourceIdxRef = useRef(0)
  const priceRef = useRef<Record<string, number>>({})
  const teardownRef = useRef<(() => void) | null>(null)
  const retryRef = useRef(0)
  const wsFailRef = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMsgRef = useRef(0)
  const aliveRef = useRef(true)

  const applyTicker = useCallback((t: Ticker) => {
    lastMsgRef.current = Date.now()
    const prev = priceRef.current[t.symbol]
    const dir: 'up' | 'down' | undefined =
      prev == null || prev === t.price ? undefined : t.price > prev ? 'up' : 'down'
    priceRef.current[t.symbol] = t.price
    setS((cur) => {
      const idx = cur.tickers.findIndex((x) => x.symbol === t.symbol)
      const tickers = idx === -1
        ? [...cur.tickers, t]
        : cur.tickers.map((x) => (x.symbol === t.symbol ? t : x))
      return {
        ...cur,
        tickers,
        status: 'live',
        flash: dir ? { ...cur.flash, [t.symbol]: dir } : cur.flash,
        updatedAt: new Date().toISOString(),
      }
    })
  }, [])

  const setSource = useCallback((src: MarketSource | null) => {
    setS((cur) => ({
      ...cur,
      source: src?.name ?? null,
      sourceLabel: src?.label ?? null,
    }))
  }, [])

  /** Drop the active stream + clear timers (without touching tickers). */
  const teardownStream = useCallback(() => {
    if (teardownRef.current) { teardownRef.current(); teardownRef.current = null }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
  }, [])

  // Forward refs for the mutually-recursive openSource ↔ scheduleReconnect.
  const openSourceRef = useRef<() => Promise<void>>(async () => {})
  const advanceSourceRef = useRef<() => Promise<void>>(async () => {})

  const scheduleReconnect = useCallback(() => {
    if (!aliveRef.current || document.visibilityState !== 'visible') return
    if (reconnectTimer.current) return
    wsFailRef.current += 1
    if (wsFailRef.current >= WS_FAIL_LIMIT) {
      // This source is failing — move on to the next.
      void advanceSourceRef.current()
      return
    }
    const n = retryRef.current++
    const base = Math.min(1000 * 2 ** n, MAX_BACKOFF)
    const delay = base / 2 + Math.random() * (base / 2)
    setS((cur) => ({ ...cur, status: cur.tickers.length ? 'reconnecting' : 'offline' }))
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null
      void openSourceRef.current()
    }, delay)
  }, [])

  const openSource = useCallback(async () => {
    if (!aliveRef.current || document.visibilityState !== 'visible') return
    teardownStream()

    const src = SOURCES[sourceIdxRef.current]
    if (!src) {
      // Exhausted sources — surface honest OFFLINE, schedule a slow retry.
      setSource(null)
      setS((cur) => ({ ...cur, status: 'offline' }))
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null
        sourceIdxRef.current = 0
        wsFailRef.current = 0
        retryRef.current = 0
        void openSourceRef.current()
      }, 30_000)
      return
    }

    setSource(src)
    setS((cur) => ({ ...cur, status: cur.tickers.length ? 'reconnecting' : 'connecting' }))

    // REST seed — short timeout. On failure (incl. 451 geoblock) skip to next source.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS)
    try {
      const snapshot = await src.fetchSnapshot(ctrl.signal)
      if (!aliveRef.current) { clearTimeout(timer); return }
      for (const t of snapshot) applyTicker(t)
    } catch {
      clearTimeout(timer)
      if (!aliveRef.current) return
      void advanceSourceRef.current()
      return
    }
    clearTimeout(timer)

    // REST worked — open the live stream for this source.
    lastMsgRef.current = Date.now()
    teardownRef.current = src.openStream(applyTicker, () => {
      if (teardownRef.current) teardownRef.current = null
      scheduleReconnect()
    })
  }, [applyTicker, scheduleReconnect, setSource, teardownStream])

  const advanceSource = useCallback(async () => {
    sourceIdxRef.current += 1
    wsFailRef.current = 0
    retryRef.current = 0
    await openSourceRef.current()
  }, [])

  openSourceRef.current = openSource
  advanceSourceRef.current = advanceSource

  useEffect(() => {
    aliveRef.current = true
    void openSource()

    // Staleness safety net — Coinbase ticks can be sparse on low-vol
    // products, so this is intentionally generous and only fires when
    // the socket is open but has been completely silent.
    staleTimer.current = setInterval(() => {
      if (teardownRef.current && Date.now() - lastMsgRef.current > STALE_MS) {
        teardownStream()
        scheduleReconnect()
      }
    }, 10_000)

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        retryRef.current = 0
        wsFailRef.current = 0
        void openSourceRef.current()
      } else {
        teardownStream()
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      aliveRef.current = false
      document.removeEventListener('visibilitychange', onVis)
      teardownStream()
      if (staleTimer.current) clearInterval(staleTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return s
}
