/**
 * CoinGecko market-overview client — global market breadth.
 *
 * Powers Phase-7 "crypto dominance + top movers" with the demo API key
 * (header x-cg-demo-api-key, base api.coingecko.com; ~30 req/min, 10k/mo).
 * Heavily cached (60s) so the whole user base shares a handful of calls.
 *
 * Exposes breadth the on-chain engines don't: total market cap, BTC/ETH
 * dominance, 24h mcap direction, and ranked top movers / trending — the
 * classic institutional market-overview panel.
 */
import 'server-only'

const BASE = 'https://api.coingecko.com/api/v3'

export function isCoinGeckoConfigured(): boolean {
  return typeof process.env.COINGECKO_API_KEY === 'string' && process.env.COINGECKO_API_KEY.length > 6
}

interface Fetched<T> { ok: true; data: T }
interface Failed { ok: false; reason: string }
type Result<T> = Fetched<T> | Failed

async function cg<T>(path: string, revalidate = 60): Promise<Result<T>> {
  const key = process.env.COINGECKO_API_KEY
  if (!key) return { ok: false, reason: 'COINGECKO_API_KEY not configured' }
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { 'x-cg-demo-api-key': key, accept: 'application/json' },
      next: { revalidate },
    })
    if (!r.ok) return { ok: false, reason: `CoinGecko ${r.status}` }
    return { ok: true, data: (await r.json()) as T }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'CoinGecko request failed' }
  }
}

// ── Public types ─────────────────────────────────────────────────────────

export interface DominanceView {
  btc_dominance:      number
  eth_dominance:      number
  alt_dominance:      number          // 100 - btc - eth
  total_mcap_usd:     number
  total_volume_usd:   number
  mcap_change_24h:    number          // %
  /** Risk-on/off read derived from dominance + breadth. */
  sentiment:          'Risk-On' | 'Risk-Off' | 'Mixed'
}

export interface MoverRow {
  symbol:             string
  name:               string
  price_usd:          number
  change_24h:         number          // %
  mcap_rank:          number | null
}

export interface MarketOverview {
  dominance:          DominanceView | null
  top_gainers:        MoverRow[]
  top_losers:         MoverRow[]
  trending:           string[]        // trending coin symbols
  generated_at:       string
  partial:            boolean
  reason?:            string
}

// ── Composers ──────────────────────────────────────────────────────────

interface GlobalResp {
  data?: {
    market_cap_percentage?: Record<string, number>
    total_market_cap?: Record<string, number>
    total_volume?: Record<string, number>
    market_cap_change_percentage_24h_usd?: number
  }
}
interface MarketCoin {
  symbol: string; name: string; current_price: number
  price_change_percentage_24h: number | null; market_cap_rank: number | null
}
interface TrendingResp { coins?: Array<{ item?: { symbol?: string } }> }

function dominanceFrom(g: GlobalResp): DominanceView | null {
  const d = g.data
  if (!d?.market_cap_percentage) return null
  const btc = d.market_cap_percentage.btc ?? 0
  const eth = d.market_cap_percentage.eth ?? 0
  const change = d.market_cap_change_percentage_24h_usd ?? 0
  // Risk-on when alts gain share AND total cap rising; risk-off when BTC
  // dominance high/rising and cap falling (flight to BTC). Coarse but useful.
  const alt = Math.max(0, 100 - btc - eth)
  const sentiment: DominanceView['sentiment'] =
    change > 1 && btc < 55 ? 'Risk-On' :
    change < -1 && btc > 58 ? 'Risk-Off' :
    'Mixed'
  return {
    btc_dominance:    Number(btc.toFixed(2)),
    eth_dominance:    Number(eth.toFixed(2)),
    alt_dominance:    Number(alt.toFixed(2)),
    total_mcap_usd:   d.total_market_cap?.usd ?? 0,
    total_volume_usd: d.total_volume?.usd ?? 0,
    mcap_change_24h:  Number(change.toFixed(2)),
    sentiment,
  }
}

export async function composeMarketOverview(): Promise<MarketOverview> {
  const generated_at = new Date().toISOString()
  if (!isCoinGeckoConfigured()) {
    return { dominance: null, top_gainers: [], top_losers: [], trending: [], generated_at, partial: true, reason: 'COINGECKO_API_KEY not configured' }
  }

  const [globalRes, marketsRes, trendingRes] = await Promise.all([
    cg<GlobalResp>('/global', 120),
    // Top 250 by mcap, with 24h change → derive movers from a liquid set
    // (avoids micro-cap noise that dominates a raw gainers endpoint).
    cg<MarketCoin[]>('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h', 60),
    cg<TrendingResp>('/search/trending', 300),
  ])

  const dominance = globalRes.ok ? dominanceFrom(globalRes.data) : null

  let top_gainers: MoverRow[] = [], top_losers: MoverRow[] = []
  if (marketsRes.ok) {
    const rows = marketsRes.data
      .filter((c) => typeof c.price_change_percentage_24h === 'number')
      .map<MoverRow>((c) => ({
        symbol: c.symbol.toUpperCase(), name: c.name, price_usd: c.current_price,
        change_24h: Number((c.price_change_percentage_24h as number).toFixed(2)),
        mcap_rank: c.market_cap_rank,
      }))
    top_gainers = [...rows].sort((a, b) => b.change_24h - a.change_24h).slice(0, 8)
    top_losers  = [...rows].sort((a, b) => a.change_24h - b.change_24h).slice(0, 8)
  }

  const trending = trendingRes.ok
    ? (trendingRes.data.coins ?? []).map((c) => c.item?.symbol?.toUpperCase()).filter((s): s is string => !!s).slice(0, 7)
    : []

  const partial = !globalRes.ok || !marketsRes.ok
  const reason = !globalRes.ok ? globalRes.reason : (!marketsRes.ok ? marketsRes.reason : undefined)
  return { dominance, top_gainers, top_losers, trending, generated_at, partial, reason }
}
