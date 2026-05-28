/**
 * Twelve Data reference catalogs — server-only.
 *
 * The /quote client (twelvedata.ts) returns LIVE prices for symbols
 * we already know. This module returns the FULL CATALOG of what's
 * available so the user can discover & pin new symbols. Reference
 * data changes rarely — we cache 24 hours via Next's fetch cache.
 *
 * Free tier: catalog endpoints don't consume the per-minute /quote
 * quota and tolerate full-list pulls. Normalised output keeps the UI
 * uniform across asset classes.
 */

import type { Quote } from './types' // re-export site for symmetry
export type { Quote }

const BASE        = 'https://api.twelvedata.com'
const TIMEOUT_MS  = 8000
const CACHE_SECS  = 24 * 60 * 60   // 24h — reference data drifts very slowly

export type CatalogClass =
  | 'forex'
  | 'commodities'
  | 'stocks'
  | 'indices'
  | 'etf'
  | 'crypto'

export interface CatalogRow {
  /** Twelve Data's symbol string (e.g. "EUR/USD", "AAPL", "BTC/USD"). */
  symbol:    string
  /** Human-readable label. */
  label:     string
  /** Asset-class context (exchange / country / currency_group / etc.). */
  context?:  string
  /** Currency the instrument is quoted in (best-effort). */
  currency?: string
}

export interface CatalogResult {
  ok:     boolean
  class:  CatalogClass
  total:  number
  rows:   CatalogRow[]
  error?: string
}

interface ApiResp { data?: unknown[]; status?: string; message?: string }

const ENDPOINT: Record<CatalogClass, string> = {
  forex:       '/forex_pairs',
  commodities: '/commodities',
  stocks:      '/stocks',
  indices:     '/indices',
  etf:         '/etf',
  crypto:      '/cryptocurrencies',
}

function s(v: unknown): string { return typeof v === 'string' ? v : '' }

function normalise(cls: CatalogClass, raw: unknown[]): CatalogRow[] {
  const out: CatalogRow[] = []
  for (const r0 of raw) {
    if (!r0 || typeof r0 !== 'object') continue
    const r = r0 as Record<string, unknown>
    const symbol = s(r.symbol) || s(r.code)
    if (!symbol) continue

    let label = s(r.name) || s(r.currency_base) || symbol
    let context: string | undefined
    let currency: string | undefined

    switch (cls) {
      case 'forex': {
        // /forex_pairs: { symbol, currency_base, currency_quote, available_exchanges? }
        const base  = s(r.currency_base)
        const quote = s(r.currency_quote)
        if (base && quote) label = `${base} / ${quote}`
        context = 'Forex'
        currency = quote
        break
      }
      case 'commodities': {
        // /commodities: { symbol, name, full_name, currency_group, currency_base, currency_quote }
        const group = s(r.currency_group) || s(r.full_name)
        if (group) context = group
        currency = s(r.currency_quote) || s(r.currency)
        break
      }
      case 'stocks': {
        // /stocks: { symbol, name, exchange, country, currency, type }
        const exch = s(r.exchange)
        const ctry = s(r.country)
        context = [exch, ctry].filter(Boolean).join(' · ')
        currency = s(r.currency)
        break
      }
      case 'indices': {
        // /indices: { symbol, name, country, currency, exchange }
        const exch = s(r.exchange)
        const ctry = s(r.country)
        context = [ctry, exch].filter(Boolean).join(' · ')
        currency = s(r.currency)
        break
      }
      case 'etf': {
        // /etf: { symbol, name, exchange, country, currency }
        const exch = s(r.exchange)
        const ctry = s(r.country)
        context = [exch, ctry].filter(Boolean).join(' · ')
        currency = s(r.currency)
        break
      }
      case 'crypto': {
        // /cryptocurrencies: { symbol, currency_base, currency_quote, available_exchanges }
        const base  = s(r.currency_base)
        const quote = s(r.currency_quote)
        if (base && quote) label = `${base} / ${quote}`
        context = 'Crypto'
        currency = quote
        break
      }
    }

    out.push({ symbol, label, context, currency })
  }
  return out
}

/** Fetch the full reference catalog for one asset class. Honest empty on failure. */
export async function getCatalog(cls: CatalogClass): Promise<CatalogResult> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key || key.length < 4) {
    return { ok: false, class: cls, total: 0, rows: [], error: 'TWELVE_DATA_API_KEY not configured' }
  }
  const path = ENDPOINT[cls]
  const url  = new URL(`${BASE}${path}`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('apikey', key)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      signal:  ctrl.signal,
      headers: { accept: 'application/json' },
      next: { revalidate: CACHE_SECS, tags: [`td-catalog-${cls}`] },
    })
    if (!res.ok) {
      return { ok: false, class: cls, total: 0, rows: [], error: `HTTP ${res.status}` }
    }
    const json = (await res.json().catch(() => null)) as ApiResp | null
    if (!json) return { ok: false, class: cls, total: 0, rows: [], error: 'bad JSON' }
    if (json.status === 'error') {
      return { ok: false, class: cls, total: 0, rows: [], error: json.message ?? 'upstream error' }
    }
    const raw = Array.isArray(json.data) ? json.data : []
    const rows = normalise(cls, raw)
    return { ok: true, class: cls, total: rows.length, rows }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : 'fetch failed'
    return { ok: false, class: cls, total: 0, rows: [], error: msg }
  } finally {
    clearTimeout(timer)
  }
}
