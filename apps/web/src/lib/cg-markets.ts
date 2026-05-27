/**
 * Shared CoinGecko top-250 markets fetcher.
 *
 * One cached URL, shared across the sector / breadth / volatility
 * composers. Next.js dedupes identical fetches with matching `revalidate`
 * across composers inside the same request, so all three engines pay
 * one upstream call at most — quota-respectful on the demo tier
 * (~30 req/min, ~10k/month).
 */
import 'server-only'

const BASE = 'https://api.coingecko.com/api/v3'

export interface CgMarketCoin {
  id:                          string
  symbol:                      string  // lowercase ticker (e.g. 'btc')
  name:                        string
  current_price:               number
  market_cap:                  number | null
  market_cap_rank:             number | null
  price_change_percentage_24h: number | null
  total_volume:                number | null
}

export interface CgMarketsResult {
  ok:     boolean
  rows:   CgMarketCoin[]
  reason?: string
}

export async function fetchTop250Markets(revalidateSeconds = 60): Promise<CgMarketsResult> {
  const key = process.env.COINGECKO_API_KEY
  if (!key) return { ok: false, rows: [], reason: 'COINGECKO_API_KEY not configured' }
  try {
    const r = await fetch(
      `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h`,
      {
        headers: { 'x-cg-demo-api-key': key, accept: 'application/json' },
        next: { revalidate: revalidateSeconds },
      },
    )
    if (!r.ok) return { ok: false, rows: [], reason: `CoinGecko ${r.status}` }
    const rows = (await r.json()) as CgMarketCoin[]
    if (!Array.isArray(rows)) return { ok: false, rows: [], reason: 'CoinGecko: unexpected payload' }
    return { ok: true, rows }
  } catch (e) {
    return { ok: false, rows: [], reason: e instanceof Error ? e.message : 'CoinGecko request failed' }
  }
}
