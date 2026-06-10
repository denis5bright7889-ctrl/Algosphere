/**
 * Market Price Service — Phase C of the Auto-Live Engine.
 *
 * Multi-provider price fetch with:
 *   • Provider hierarchy per asset class (crypto / forex / metals)
 *   • Per-provider circuit breaker (consecutive-failure threshold)
 *   • In-memory price cache (5s default TTL — prevents hammering)
 *   • Persistent health log in market_feed_status (durable across
 *     cold starts; service-role reads on startup to pick up state)
 *
 * Honesty contract:
 *   - Returns { status: 'unavailable' } when ALL providers fail.
 *     NEVER fabricates a price.
 *   - Circuit-breaker state is honest: open = all providers failing,
 *     half_open = trying again, closed = healthy.
 *   - The cache is a price snapshot, not a forecast. Stale entries
 *     (> ttl) are NEVER returned without re-fetch.
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type AssetClass = 'crypto' | 'forex' | 'metals' | 'unknown'

export interface PriceResult {
  status:    'ok' | 'unavailable'
  price?:    number
  provider?: string
  fetched_at?: string
  cached?:   boolean
}

interface ProviderAdapter {
  name: string
  fetch: (symbol: string) => Promise<number | null>
}

interface CacheEntry { price: number; at: number; provider: string }

const PRICE_CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5_000

// In-process circuit breaker state. The DB row in market_feed_status
// is the durable source of truth across processes; this is the hot
// path replica.
interface BreakerState {
  consecutive_failures: number
  state:                'closed' | 'open' | 'half_open'
  next_retry_at:        number   // epoch ms; 0 = no embargo
}
const BREAKER_STATE = new Map<string, BreakerState>()
const FAILURE_THRESHOLD = 5
const OPEN_DURATION_MS  = 60_000

function breakerKey(provider: string, ac: AssetClass): string { return `${provider}|${ac}` }

function getBreaker(provider: string, ac: AssetClass): BreakerState {
  const k = breakerKey(provider, ac)
  const s = BREAKER_STATE.get(k)
  if (s) return s
  const init: BreakerState = { consecutive_failures: 0, state: 'closed', next_retry_at: 0 }
  BREAKER_STATE.set(k, init)
  return init
}

function isBlocked(provider: string, ac: AssetClass): boolean {
  const s = getBreaker(provider, ac)
  if (s.state === 'open' && Date.now() < s.next_retry_at) return true
  if (s.state === 'open' && Date.now() >= s.next_retry_at) {
    s.state = 'half_open'
  }
  return false
}

async function recordSuccess(provider: string, ac: AssetClass): Promise<void> {
  const s = getBreaker(provider, ac)
  s.consecutive_failures = 0
  s.state = 'closed'
  s.next_retry_at = 0
  await persistBreaker(provider, ac, s, true, null)
}

async function recordFailure(provider: string, ac: AssetClass, error: string): Promise<void> {
  const s = getBreaker(provider, ac)
  s.consecutive_failures += 1
  if (s.consecutive_failures >= FAILURE_THRESHOLD) {
    s.state = 'open'
    s.next_retry_at = Date.now() + OPEN_DURATION_MS
  }
  await persistBreaker(provider, ac, s, false, error)
}

async function persistBreaker(
  provider: string, ac: AssetClass, s: BreakerState,
  success: boolean, error: string | null,
): Promise<void> {
  try {
    const db = svc()
    await db.from('market_feed_status').upsert({
      provider,
      asset_class: ac,
      state:                s.state,
      consecutive_failures: s.consecutive_failures,
      last_success_at:      success ? new Date().toISOString() : undefined,
      last_failure_at:      success ? undefined : new Date().toISOString(),
      last_error:           success ? null : error,
      next_retry_at:        s.next_retry_at > 0 ? new Date(s.next_retry_at).toISOString() : null,
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'provider,asset_class' })
  } catch { /* persistence is best-effort */ }
}

// ── Adapters ────────────────────────────────────────────────────────

const BINANCE: ProviderAdapter = {
  name: 'binance',
  async fetch(symbol) {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`binance ${res.status}`)
    const j = (await res.json()) as { price?: string }
    const p = typeof j.price === 'string' ? Number(j.price) : NaN
    if (!Number.isFinite(p) || p <= 0) throw new Error('binance invalid price')
    return p
  },
}

const COINBASE: ProviderAdapter = {
  name: 'coinbase',
  async fetch(symbol) {
    // Binance BTCUSDT → Coinbase BTC-USD
    const s = symbol.toUpperCase()
    const base = s.endsWith('USDT') ? s.slice(0, -4)
              : s.endsWith('USDC') ? s.slice(0, -4)
              : s.endsWith('USD')  ? s.slice(0, -3)
              : null
    if (!base) throw new Error('coinbase symbol mapping')
    const res = await fetch(
      `https://api.exchange.coinbase.com/products/${base}-USD/ticker`,
      { cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`coinbase ${res.status}`)
    const j = (await res.json()) as { price?: string }
    const p = typeof j.price === 'string' ? Number(j.price) : NaN
    if (!Number.isFinite(p) || p <= 0) throw new Error('coinbase invalid price')
    return p
  },
}

const KRAKEN: ProviderAdapter = {
  name: 'kraken',
  async fetch(symbol) {
    // Binance BTCUSDT → Kraken XBTUSD / ETHUSD
    const s = symbol.toUpperCase()
    let base = s.endsWith('USDT') ? s.slice(0, -4)
             : s.endsWith('USDC') ? s.slice(0, -4)
             : s.endsWith('USD')  ? s.slice(0, -3)
             : null
    if (!base) throw new Error('kraken symbol mapping')
    if (base === 'BTC') base = 'XBT'
    const pair = `${base}USD`
    const res = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`kraken ${res.status}`)
    const j = (await res.json()) as { result?: Record<string, { c?: string[] }>; error?: string[] }
    if (j.error && j.error.length > 0) throw new Error('kraken: ' + j.error.join(','))
    const result = j.result ?? {}
    const firstKey = Object.keys(result)[0]
    if (!firstKey) throw new Error('kraken empty result')
    const close = result[firstKey]?.c?.[0]
    const p = typeof close === 'string' ? Number(close) : NaN
    if (!Number.isFinite(p) || p <= 0) throw new Error('kraken invalid price')
    return p
  },
}

const TD_SYMBOL_MAP: Record<string, string> = {
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD', NZDUSD: 'NZD/USD', USDCHF: 'USD/CHF',
  USDCAD: 'USD/CAD', GBPJPY: 'GBP/JPY', EURJPY: 'EUR/JPY',
  EURGBP: 'EUR/GBP', XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD',
  XPTUSD: 'XPT/USD', XPDUSD: 'XPD/USD',
}

const TWELVEDATA: ProviderAdapter = {
  name: 'twelvedata',
  async fetch(symbol) {
    const key = process.env.TWELVE_DATA_API_KEY
    if (!key) throw new Error('twelvedata no_api_key')
    const td = TD_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(td)}&apikey=${key}`,
      { cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`twelvedata ${res.status}`)
    const j = (await res.json()) as { price?: string; status?: string }
    if (j.status === 'error') throw new Error('twelvedata error')
    const p = typeof j.price === 'string' ? Number(j.price) : NaN
    if (!Number.isFinite(p) || p <= 0) throw new Error('twelvedata invalid price')
    return p
  },
}

// ── Classification + provider order ────────────────────────────────

export function classifySymbol(symbol: string): AssetClass {
  const s = symbol.toUpperCase()
  if (s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('BUSD')) return 'crypto'
  if (TD_SYMBOL_MAP[s]) {
    if (s.startsWith('XAU') || s.startsWith('XAG') ||
        s.startsWith('XPT') || s.startsWith('XPD')) return 'metals'
    return 'forex'
  }
  return 'unknown'
}

function providerOrder(ac: AssetClass): ProviderAdapter[] {
  if (ac === 'crypto') return [BINANCE, COINBASE, KRAKEN]
  if (ac === 'forex' || ac === 'metals') return [TWELVEDATA]
  return []
}

// ── Public API ─────────────────────────────────────────────────────

export async function fetchPrice(symbol: string): Promise<PriceResult> {
  const ac = classifySymbol(symbol)
  const cached = PRICE_CACHE.get(symbol)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return {
      status:     'ok',
      price:      cached.price,
      provider:   cached.provider,
      fetched_at: new Date(cached.at).toISOString(),
      cached:     true,
    }
  }

  const order = providerOrder(ac)
  if (order.length === 0) return { status: 'unavailable' }

  for (const adapter of order) {
    if (isBlocked(adapter.name, ac)) continue
    try {
      const price = await adapter.fetch(symbol)
      if (price == null || !Number.isFinite(price) || price <= 0) {
        await recordFailure(adapter.name, ac, 'invalid_price')
        continue
      }
      await recordSuccess(adapter.name, ac)
      PRICE_CACHE.set(symbol, { price, at: Date.now(), provider: adapter.name })
      return {
        status:     'ok',
        price,
        provider:   adapter.name,
        fetched_at: new Date().toISOString(),
        cached:     false,
      }
    } catch (e) {
      await recordFailure(adapter.name, ac, e instanceof Error ? e.message : String(e))
    }
  }

  return { status: 'unavailable' }
}

// Bulk fetch with deduplication
export async function fetchPrices(symbols: string[]): Promise<Map<string, PriceResult>> {
  const unique = Array.from(new Set(symbols))
  const out = new Map<string, PriceResult>()
  await Promise.all(unique.map(async s => {
    out.set(s, await fetchPrice(s))
  }))
  return out
}
