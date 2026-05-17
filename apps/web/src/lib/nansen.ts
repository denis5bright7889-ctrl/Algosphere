/**
 * Nansen API client — server-only smart-money / whale intelligence.
 *
 * The API key MUST stay server-side (env: NANSEN_API_KEY). This module
 * is imported only from API routes and server components. Never import
 * from a 'use client' file.
 *
 * Endpoint reference (probed 2026-05-17):
 *   POST https://api.nansen.ai/api/v1/token-screener
 *   Header: apiKey: <NANSEN_API_KEY>
 *   Response:
 *     { data: NansenToken[], pagination?: {...} }
 */

export type NansenChain = 'ethereum' | 'solana' | 'base'
export type NansenTimeframe = '1h' | '24h' | '7d' | '30d'
export type NansenOrderField = 'buy_volume' | 'sell_volume' | 'volume' | 'netflow' | 'price_change' | 'market_cap_usd'

export interface NansenToken {
  chain:             string
  token_address:     string
  token_symbol:      string
  token_age_days:    number
  market_cap_usd:    number
  liquidity:         number
  price_usd:         number
  price_change:      number   // ratio: 0.12 = +12%, -0.34 = −34%
  fdv:               number
  fdv_mc_ratio:      number
  nof_traders:       number
  buy_volume:        number
  inflow_fdv_ratio:  number
  outflow_fdv_ratio: number
  sell_volume:       number
  volume:            number
  netflow:           number
}

export interface ScreenerParams {
  chains?:    NansenChain[]
  timeframe?: NansenTimeframe
  orderBy?:   NansenOrderField
  direction?: 'ASC' | 'DESC'
  limit?:     number
  minAgeDays?: number
  maxAgeDays?: number
}

const ENDPOINT = 'https://api.nansen.ai/api/v1/token-screener'

export class NansenError extends Error {
  constructor(message: string, public readonly code: string, public readonly status?: number) {
    super(message)
  }
}

export function isNansenConfigured(): boolean {
  return typeof process.env.NANSEN_API_KEY === 'string' && process.env.NANSEN_API_KEY.length > 8
}

/** Smart-money token screener. Throws NansenError on any failure. */
export async function tokenScreener(opts: ScreenerParams = {}): Promise<NansenToken[]> {
  const key = process.env.NANSEN_API_KEY
  if (!key) throw new NansenError('NANSEN_API_KEY not configured', 'no_key')

  const body = {
    chains:    opts.chains    ?? ['ethereum', 'solana', 'base'],
    timeframe: opts.timeframe ?? '24h',
    filters: {
      only_smart_money: true,
      token_age_days: {
        min: opts.minAgeDays ?? 1,
        max: opts.maxAgeDays ?? 365,
      },
    },
    order_by: [
      {
        field:     opts.orderBy   ?? 'buy_volume',
        direction: opts.direction ?? 'DESC',
      },
    ],
    pagination: { page: 1, per_page: Math.min(opts.limit ?? 50, 100) },
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15_000)
  try {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', apiKey: key },
      body:    JSON.stringify(body),
      signal:  ctl.signal,
      // Cache at the runtime layer — same params hit Nansen at most once/min.
      next: { revalidate: 60 },
    })
    if (!res.ok) {
      throw new NansenError(`Nansen ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 240), 'http_error', res.status)
    }
    const json = await res.json() as { data?: NansenToken[] }
    return Array.isArray(json.data) ? json.data : []
  } catch (e) {
    if (e instanceof NansenError) throw e
    if ((e as Error)?.name === 'AbortError') {
      throw new NansenError('Nansen request timed out', 'timeout')
    }
    throw new NansenError((e as Error)?.message ?? 'Nansen request failed', 'fetch_error')
  } finally {
    clearTimeout(timer)
  }
}
