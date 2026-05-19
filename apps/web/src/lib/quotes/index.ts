/**
 * Quote orchestrator — dispatches each instrument to its declared
 * provider, then folds results back into our universe-symbol space.
 *
 * Public to server code only (route handlers, server components).
 * The browser never sees provider names without indirection through
 * /api/quotes, so API keys stay on the server.
 */

import {
  MARKET_UNIVERSE, configuredProviders, type Instrument, type Provider,
} from '@/lib/market-universe'
import { getQuotes as tdQuotes } from './twelvedata'
import { getQuotes as fhQuotes } from './finnhub'
import type { Quote } from './types'

export type { Quote }

export interface UniverseQuote {
  /** Our canonical universe symbol (e.g. 'EURUSD'). */
  symbol:    string
  price:     number
  changePct: number
  source:    'twelvedata' | 'finnhub'
  fetchedAt: string
}

const SYMBOL_INDEX: Map<string, Instrument> = (() => {
  const m = new Map<string, Instrument>()
  for (const c of MARKET_UNIVERSE) for (const i of c.instruments) m.set(i.symbol, i)
  return m
})()

export function instrumentBySymbol(sym: string): Instrument | undefined {
  return SYMBOL_INDEX.get(sym)
}

/**
 * Fetch the latest quote for each requested universe symbol.
 * Behaviour:
 *  - Skips symbols unknown to the universe.
 *  - Skips symbols whose provider key isn't configured (caller can
 *    detect missing entries vs server config via /api/quotes meta).
 *  - Batches Twelve Data, fans-out Finnhub, runs both in parallel.
 *  - On any provider error: silently absent (caller decides what to
 *    render — we never invent a price).
 */
export async function getUniverseQuotes(symbols: string[]): Promise<Map<string, UniverseQuote>> {
  const out = new Map<string, UniverseQuote>()
  if (symbols.length === 0) return out
  const cfg = configuredProviders()

  // Bucket symbols by declared provider, mapping our-symbol → provider-symbol.
  const tdAsk: Array<[ourSym: string, providerSym: string]> = []
  const fhAsk: Array<[ourSym: string, providerSym: string]> = []

  for (const s of symbols) {
    const inst = SYMBOL_INDEX.get(s)
    if (!inst || !inst.provider) continue
    if (!cfg.has(inst.provider)) continue
    const psym = inst.providerSymbol ?? inst.symbol
    if (inst.provider === 'twelvedata') tdAsk.push([s, psym])
    else if (inst.provider === 'finnhub') fhAsk.push([s, psym])
    // 'crypto-stream' is browser-direct via the WS singleton — not
    // served by /api/quotes; the caller already has it.
  }

  const [tdResults, fhResults] = await Promise.all([
    tdAsk.length ? tdQuotes(tdAsk.map(([, p]) => p)) : Promise.resolve(new Map<string, Quote>()),
    fhAsk.length ? fhQuotes(fhAsk.map(([, p]) => p)) : Promise.resolve(new Map<string, Quote>()),
  ])

  for (const [ourSym, psym] of tdAsk) {
    const q = tdResults.get(psym)
    if (q) out.set(ourSym, { ...q, symbol: ourSym })
  }
  for (const [ourSym, psym] of fhAsk) {
    const q = fhResults.get(psym)
    if (q) out.set(ourSym, { ...q, symbol: ourSym })
  }

  return out
}

/** Diagnostic: which providers does the server have keys for? */
export function providerStatus(): Record<Exclude<Provider, null>, boolean> {
  const cfg = configuredProviders()
  return {
    'crypto-stream': cfg.has('crypto-stream'),
    twelvedata:      cfg.has('twelvedata'),
    finnhub:         cfg.has('finnhub'),
  }
}
