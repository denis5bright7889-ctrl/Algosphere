/**
 * Module-singleton market stream.
 *
 * One Binance/Coinbase WebSocket for the entire app session — no
 * matter how many components subscribe. Components subscribe via
 * `useCryptoTickers()` (full state) or `useCryptoTicker(symbol)`
 * (single ticker selector). The stream starts on the first
 * subscriber and shuts down on the last unsubscribe, so a route
 * that never needs prices pays zero cost.
 *
 * The selector pattern relies on stable Ticker references for
 * unchanged symbols (see `applyTicker`'s `.map` preservation), which
 * lets `useSyncExternalStore` bail out per-symbol re-renders.
 */

import { binanceSource, type Ticker } from '@/lib/binance'
import { coinbaseSource } from '@/lib/coinbase'
import type { MarketSource, SourceName } from '@/lib/market-source'

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface StreamState {
  tickers: Ticker[]
  status: StreamStatus
  flash: Record<string, 'up' | 'down' | undefined>
  updatedAt: string | null
  source: SourceName | null
  sourceLabel: string | null
}

const SOURCES: MarketSource[] = [binanceSource, coinbaseSource]

const STALE_MS = 60_000
const MAX_BACKOFF = 20_000
const REST_TIMEOUT_MS = 4_000
const WS_FAIL_LIMIT = 3

const EMPTY_STATE: StreamState = {
  tickers: [], status: 'connecting', flash: {},
  updatedAt: null, source: null, sourceLabel: null,
}

let state: StreamState = EMPTY_STATE
const listeners = new Set<() => void>()

// Stream machinery — lifted from the previous per-mount hook.
let sourceIdx = 0
let teardown: (() => void) | null = null
let retry = 0
let wsFail = 0
let lastMsg = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let visBound = false
let visHandler: (() => void) | null = null
const priceRef: Record<string, number> = {}

function setState(updater: (s: StreamState) => StreamState) {
  const next = updater(state)
  if (next === state) return
  state = next
  for (const l of listeners) l()
}

function applyTicker(t: Ticker) {
  lastMsg = Date.now()
  const prev = priceRef[t.symbol]
  const dir: 'up' | 'down' | undefined =
    prev == null || prev === t.price ? undefined : t.price > prev ? 'up' : 'down'
  priceRef[t.symbol] = t.price
  setState((cur) => {
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
}

function setSource(src: MarketSource | null) {
  setState((cur) =>
    cur.source === (src?.name ?? null) && cur.sourceLabel === (src?.label ?? null)
      ? cur
      : { ...cur, source: src?.name ?? null, sourceLabel: src?.label ?? null },
  )
}

function killStream() {
  if (teardown) { teardown(); teardown = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
}

function scheduleReconnect() {
  if (listeners.size === 0 || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return
  if (reconnectTimer) return
  wsFail += 1
  if (wsFail >= WS_FAIL_LIMIT) {
    void advanceSource()
    return
  }
  const n = retry++
  const base = Math.min(1000 * 2 ** n, MAX_BACKOFF)
  const delay = base / 2 + Math.random() * (base / 2)
  setState((cur) => ({ ...cur, status: cur.tickers.length ? 'reconnecting' : 'offline' }))
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void openSource() }, delay)
}

async function openSource() {
  if (listeners.size === 0 || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return
  killStream()

  const src = SOURCES[sourceIdx]
  if (!src) {
    setSource(null)
    setState((cur) => ({ ...cur, status: 'offline' }))
    // Slow retry from top — exchanges may have transient outages.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      sourceIdx = 0; wsFail = 0; retry = 0
      void openSource()
    }, 30_000)
    return
  }

  setSource(src)
  setState((cur) => ({ ...cur, status: cur.tickers.length ? 'reconnecting' : 'connecting' }))

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS)
  try {
    const snapshot = await src.fetchSnapshot(ctrl.signal)
    for (const t of snapshot) applyTicker(t)
  } catch {
    clearTimeout(timer)
    void advanceSource()
    return
  }
  clearTimeout(timer)

  lastMsg = Date.now()
  teardown = src.openStream(applyTicker, () => {
    if (teardown) teardown = null
    scheduleReconnect()
  })
}

async function advanceSource() {
  sourceIdx += 1
  wsFail = 0
  retry = 0
  await openSource()
}

function startIfFirst() {
  if (listeners.size !== 1) return
  if (typeof document === 'undefined') return

  visHandler = () => {
    if (document.visibilityState === 'visible') {
      retry = 0; wsFail = 0
      void openSource()
    } else {
      killStream()
    }
  }
  document.addEventListener('visibilitychange', visHandler)
  visBound = true

  staleTimer = setInterval(() => {
    if (teardown && Date.now() - lastMsg > STALE_MS) {
      killStream()
      scheduleReconnect()
    }
  }, 10_000)

  void openSource()
}

function stopIfLast() {
  if (listeners.size !== 0) return
  killStream()
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null }
  if (visBound && visHandler) {
    document.removeEventListener('visibilitychange', visHandler)
    visBound = false
    visHandler = null
  }
  // Reset state so a future remount starts fresh.
  sourceIdx = 0; wsFail = 0; retry = 0
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  startIfFirst()
  return () => {
    listeners.delete(listener)
    stopIfLast()
  }
}

export function getSnapshot(): StreamState {
  return state
}

/** Stable empty snapshot for SSR — same reference every call. */
export function getServerSnapshot(): StreamState {
  return EMPTY_STATE
}
