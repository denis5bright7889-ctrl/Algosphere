'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  WS_URL, REST_URL, normalizeRest, normalizeWs, type Ticker, type WsTicker,
} from '@/lib/binance'

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

interface State {
  tickers: Ticker[]
  status: StreamStatus
  /** Per-symbol last tick direction — drives the price flash. */
  flash: Record<string, 'up' | 'down' | undefined>
  /** ISO of the last accepted update (REST seed or WS tick). */
  updatedAt: string | null
}

const STALE_MS = 15_000
const MAX_BACKOFF = 20_000

/**
 * Live crypto tape from Binance public WS, REST-seeded.
 *
 * Resilience: exponential backoff + jitter on reconnect (reset once
 * healthy), a staleness watchdog that forces a reconnect if the
 * socket goes quiet, and full teardown / pause when the tab is
 * hidden (no background sockets, no wasted frames). Never fabricates
 * a price — on total failure it surfaces `offline` and holds the
 * last real values.
 */
export function useCryptoTickers() {
  const [s, setS] = useState<State>({
    tickers: [], status: 'connecting', flash: {}, updatedAt: null,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const priceRef = useRef<Record<string, number>>({})
  const retryRef = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMsgRef = useRef(0)
  const aliveRef = useRef(true)

  const applyTicker = useCallback((t: Ticker) => {
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
        tickers,
        status: 'live',
        flash: dir ? { ...cur.flash, [t.symbol]: dir } : cur.flash,
        updatedAt: new Date().toISOString(),
      }
    })
  }, [])

  /**
   * Snapshot fetch goes directly to Binance public REST from the
   * browser (CORS: `*`). A server proxy can't help here — Binance
   * geoblocks Vercel's US-edge egress with HTTP 451, while the user's
   * own IP almost always reaches the public API. When even the
   * browser can't reach it, we honestly surface `offline` rather
   * than fabricating prices.
   */
  const seedFromRest = useCallback(async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    try {
      const res = await fetch(REST_URL, { signal: ctrl.signal, cache: 'no-store' })
      const rows = await res.json().catch(() => null)
      if (!aliveRef.current) return
      if (res.ok && Array.isArray(rows)) {
        for (const t of normalizeRest(rows)) applyTicker(t)
      } else {
        setS((cur) => ({ ...cur, status: cur.tickers.length ? cur.status : 'offline' }))
      }
    } catch {
      if (aliveRef.current) {
        setS((cur) => ({ ...cur, status: cur.tickers.length ? cur.status : 'offline' }))
      }
    } finally {
      clearTimeout(timer)
    }
  }, [applyTicker])

  const connect = useCallback(() => {
    if (!aliveRef.current || document.visibilityState !== 'visible') return
    if (wsRef.current) { try { wsRef.current.close() } catch { /* noop */ } }

    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL)
    } catch {
      scheduleReconnect()
      return
    }
    wsRef.current = ws
    setS((cur) => ({ ...cur, status: cur.tickers.length ? 'reconnecting' : 'connecting' }))

    ws.onopen = () => {
      retryRef.current = 0
      lastMsgRef.current = Date.now()
    }
    ws.onmessage = (ev) => {
      lastMsgRef.current = Date.now()
      try {
        const env = JSON.parse(ev.data as string) as { data?: WsTicker }
        if (!env?.data) return
        const t = normalizeWs(env.data)
        if (t) applyTicker(t)
      } catch { /* ignore malformed frame */ }
    }
    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      scheduleReconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyTicker])

  const scheduleReconnect = useCallback(() => {
    if (!aliveRef.current || document.visibilityState !== 'visible') return
    if (reconnectTimer.current) return
    const n = retryRef.current++
    const base = Math.min(1000 * 2 ** n, MAX_BACKOFF)
    const delay = base / 2 + Math.random() * (base / 2) // jitter
    setS((cur) => ({ ...cur, status: cur.tickers.length ? 'reconnecting' : 'offline' }))
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null
      connect()
    }, delay)
  }, [connect])

  useEffect(() => {
    aliveRef.current = true
    seedFromRest()
    connect()

    // Staleness watchdog — Binance pushes ~1/s; silence = dead socket.
    staleTimer.current = setInterval(() => {
      if (
        wsRef.current?.readyState === WebSocket.OPEN &&
        Date.now() - lastMsgRef.current > STALE_MS
      ) {
        try { wsRef.current.close() } catch { /* noop */ }
      }
    }, 5000)

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        retryRef.current = 0
        seedFromRest()
        connect()
      } else {
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
        if (wsRef.current) { try { wsRef.current.close() } catch { /* noop */ } }
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      aliveRef.current = false
      document.removeEventListener('visibilitychange', onVis)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (staleTimer.current) clearInterval(staleTimer.current)
      if (wsRef.current) { try { wsRef.current.close() } catch { /* noop */ } }
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return s
}
