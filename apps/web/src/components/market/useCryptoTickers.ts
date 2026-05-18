'use client'

import { useSyncExternalStore } from 'react'
import type { Ticker } from '@/lib/binance'
import {
  subscribe, getSnapshot, getServerSnapshot,
  type StreamState, type StreamStatus,
} from './market-stream'

export type { StreamStatus }

/**
 * Full market-stream state. Any consumer using this hook re-renders
 * on every accepted tick. For per-symbol consumers (e.g. a single
 * signal card), use `useCryptoTicker(symbol)` instead — it only
 * re-renders when that symbol's Ticker reference changes.
 */
export function useCryptoTickers(): StreamState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Per-symbol selector. Returns the latest Ticker for `symbol`, or
 * null if the active source doesn't carry it / the stream is offline.
 *
 * `useSyncExternalStore` bails out on Object.is-equal snapshots, and
 * `market-stream.applyTicker` keeps a Ticker's object reference
 * stable when only *other* symbols update — so this hook stays inert
 * for unrelated ticks. This is the perf foundation that lets dozens
 * of signal cards consume the same WS without churn.
 */
export function useCryptoTicker(symbol: string): Ticker | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().tickers.find((t) => t.symbol === symbol) ?? null,
    () => null,
  )
}

/** Canonical crypto labels we can match across both exchange adapters. */
const CRYPTO_LABELS = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'])

/**
 * Normalise a signal pair like 'BTCUSDT' or 'BTC-USD' to the canonical
 * `Ticker.label` ('BTC'). Returns null for non-crypto pairs (XAUUSD,
 * EURUSD, …) so the caller can skip rendering live progress.
 */
export function cryptoLabelForPair(pair: string | null | undefined): string | null {
  if (!pair) return null
  if (pair.endsWith('USDT')) {
    const base = pair.slice(0, -4)
    return CRYPTO_LABELS.has(base) ? base : null
  }
  if (pair.endsWith('-USD') || pair.endsWith('USD')) {
    const base = pair.replace(/-?USD$/, '')
    return CRYPTO_LABELS.has(base) ? base : null
  }
  return null
}

/**
 * Per-pair selector — same bail-out semantics as `useCryptoTicker`.
 * `pair` accepts the signal's stored format (e.g. 'BTCUSDT'); null
 * is returned for non-crypto pairs.
 */
export function useCryptoTickerForPair(pair: string | null | undefined): Ticker | null {
  const label = cryptoLabelForPair(pair)
  return useSyncExternalStore(
    subscribe,
    () => (label ? getSnapshot().tickers.find((t) => t.label === label) ?? null : null),
    () => null,
  )
}
