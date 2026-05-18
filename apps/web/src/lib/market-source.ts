/**
 * Cross-exchange market-source abstraction.
 *
 * The UI never knows which exchange answered — it sees normalised
 * `Ticker` rows and the active source name. Each adapter
 * implementation (binance, coinbase, ...) returns one of these
 * objects. The hook can race them or fall back between them to
 * survive regional geoblocking (Binance.com → US edges 451;
 * Coinbase Exchange → universally reachable) without ever
 * fabricating a price.
 */

import type { Ticker } from '@/lib/binance'

export type SourceName = 'binance' | 'coinbase'

export interface MarketSource {
  /** Identifier surfaced in the UI / logs. */
  readonly name: SourceName
  /** Display label for the footer. */
  readonly label: string

  /** Real REST snapshot from this exchange. Throws on upstream error. */
  fetchSnapshot(signal: AbortSignal): Promise<Ticker[]>

  /**
   * Open a live tick stream. Calls `onTicker` for each accepted tick.
   * Returns a teardown that closes the underlying socket.
   * `onClose` fires when the socket terminates (clean or error) so
   * the consumer can manage reconnect/backoff itself.
   */
  openStream(
    onTicker: (t: Ticker) => void,
    onClose: () => void,
  ): () => void
}
