/**
 * Liquidity Intelligence Engine.
 *
 * Per the brief (Section 2): institutional liquidity intelligence —
 * imbalance zones, resting-liquidity walls, liquidity voids, thin-liquidity
 * detection, sweep probability, execution stability, manipulation risk.
 *
 * Source: Coinbase Exchange public L2 order book (free, no auth, real).
 * We analyse the CURRENT book STRUCTURE — not a fabricated sweep history.
 *
 * What a single L2 snapshot CAN show honestly:
 *   - bid/ask imbalance (directional pressure)
 *   - resting-liquidity walls (stop clusters / defended levels)
 *   - liquidity voids (thin zones price can slip through → sweep-prone)
 *   - book depth within bands (thin-liquidity detection)
 *   - spread condition (execution stability)
 *   - a composite liquidity-quality score
 *
 * What it CANNOT (and we DON'T fake):
 *   - absorption (needs a time series) → not reported
 *   - exact forced-liquidation prices (needs per-venue leverage maps) →
 *     not reported; funding-based positioning lives in the Positioning
 *     Engine instead
 *
 * Anti-cloning: never exposes raw level-by-level book data or the exact
 * wall/void thresholds. Only institutional STATES + a quality score +
 * the zone prices that matter.
 */
import 'server-only'

const COINBASE_BASE = 'https://api.exchange.coinbase.com'

// ── Public types ─────────────────────────────────────────────────────────

export type ExecutionCondition =
  | 'Favorable'          // tight spread, deep, balanced
  | 'Imbalanced'         // depth skewed one side
  | 'Thin Liquidity'     // shallow book — slippage risk
  | 'Sweep Risk Elevated'// voids near mid → stop-run prone
  | 'Unstable'           // wide spread / fragmented
  | 'Unknown'

export type SpreadCondition = 'Tight' | 'Normal' | 'Wide' | 'N/A'
export type DepthCondition  = 'Deep' | 'Adequate' | 'Thin' | 'N/A'
export type ImbalanceState  = 'Bid-Heavy' | 'Balanced' | 'Ask-Heavy' | 'N/A'
export type SweepRisk       = 'Low' | 'Moderate' | 'Elevated' | 'N/A'
export type ManipulationRisk = 'Low' | 'Moderate' | 'Elevated' | 'N/A'

export interface LiquidityZone {
  side:        'bid' | 'ask'
  /** Distance from mid as a signed % (negative = below mid). */
  distance_pct: number
  /** Relative size vs the median level in-band — a label, not raw size. */
  scale:       'Mega' | 'Large' | 'Notable'
}

export interface AssetLiquidityView {
  symbol:               string
  execution_condition:  ExecutionCondition
  spread_condition:     SpreadCondition
  depth_condition:      DepthCondition
  imbalance:            ImbalanceState
  /** 0..100 bid share of near-mid depth (50 = balanced). */
  imbalance_pct:        number
  sweep_risk:           SweepRisk
  manipulation_risk:    ManipulationRisk
  /** 0..100 composite liquidity quality (higher = better execution). */
  quality_score:        number
  /** Up to 4 notable resting-liquidity walls near mid. */
  walls:                LiquidityZone[]
  /** Up to 2 nearest liquidity voids (thin zones price can slip through). */
  voids:                LiquidityZone[]
  narrative:            string
  partial:              boolean      // true when book was unavailable
}

export interface LiquidityBoard {
  views:                AssetLiquidityView[]
  summary: {
    favorable:          number       // count of assets with favorable execution
    sweep_risk:         number       // count flagged sweep-risk-elevated
    narrative:          string
  }
  generated_at:         string
  partial:              boolean
}

// ── Coinbase product mapping ─────────────────────────────────────────────

const PRODUCT_MAP: Record<string, string> = {
  BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', SOLUSDT: 'SOL-USD',
  XRPUSDT: 'XRP-USD', ADAUSDT: 'ADA-USD', DOGEUSDT: 'DOGE-USD',
  AVAXUSDT: 'AVAX-USD', LINKUSDT: 'LINK-USD', LTCUSDT: 'LTC-USD',
  DOTUSDT: 'DOT-USD',
}
function productOf(symbol: string): string | null {
  const s = symbol.toUpperCase()
  if (PRODUCT_MAP[s]) return PRODUCT_MAP[s]
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USD`
  return null
}

const DEFAULT_BASKET = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT', 'DOTUSDT',
]

// ── Book analysis ────────────────────────────────────────────────────────

type Level = [price: number, size: number]
interface Book { bids: Level[]; asks: Level[] }

/** Tunable bands / thresholds — live here, never exposed in the response. */
const NEAR_BAND_PCT      = 0.01      // ±1% of mid for imbalance + depth
const WALL_BAND_PCT      = 0.03      // ±3% for wall scanning
const WALL_MULT_NOTABLE  = 4         // size >= 4× median level = notable wall
const WALL_MULT_LARGE    = 8
const WALL_MULT_MEGA     = 20
const VOID_GAP_PCT       = 0.0015    // a 0.15% price gap with no resting size = void
const SPREAD_TIGHT_BPS   = 3
const SPREAD_WIDE_BPS    = 25
const THIN_DEPTH_USD     = 250_000   // near-band depth below this = thin
const DEEP_DEPTH_USD     = 3_000_000

async function fetchBook(product: string): Promise<Book | null> {
  try {
    const r = await fetch(`${COINBASE_BASE}/products/${product}/book?level=2`, {
      headers: { 'User-Agent': 'algosphere-liquidity' },
      // Order books move fast but page-load snapshots don't need sub-second
      // freshness; 30s keeps request volume sane against the public API.
      next: { revalidate: 30 },
    })
    if (!r.ok) return null
    const j = (await r.json()) as { bids?: [string, string, number][]; asks?: [string, string, number][] }
    const toLevels = (arr?: [string, string, number][]): Level[] =>
      (arr ?? []).slice(0, 1500).map((l) => [parseFloat(l[0]), parseFloat(l[1])] as Level)
        .filter((l) => Number.isFinite(l[0]) && Number.isFinite(l[1]))
    return { bids: toLevels(j.bids), asks: toLevels(j.asks) }
  } catch {
    return null
  }
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function analyse(symbol: string, book: Book | null): AssetLiquidityView {
  if (!book || book.bids.length === 0 || book.asks.length === 0) {
    return emptyAsset(symbol)
  }
  const bestBid = book.bids[0]![0]
  const bestAsk = book.asks[0]![0]
  const mid     = (bestBid + bestAsk) / 2
  const spreadBps = ((bestAsk - bestBid) / mid) * 1e4

  // Near-band depth (±1%) in USD
  const bidNear = book.bids.filter((l) => l[0] >= mid * (1 - NEAR_BAND_PCT))
  const askNear = book.asks.filter((l) => l[0] <= mid * (1 + NEAR_BAND_PCT))
  const bidDepthUsd = bidNear.reduce((s, l) => s + l[0] * l[1], 0)
  const askDepthUsd = askNear.reduce((s, l) => s + l[0] * l[1], 0)
  const totalDepthUsd = bidDepthUsd + askDepthUsd
  const imbalancePct = totalDepthUsd > 0 ? (bidDepthUsd / totalDepthUsd) * 100 : 50

  // Spread / depth conditions
  const spread_condition: SpreadCondition =
    spreadBps <= SPREAD_TIGHT_BPS ? 'Tight' : spreadBps <= SPREAD_WIDE_BPS ? 'Normal' : 'Wide'
  const depth_condition: DepthCondition =
    totalDepthUsd >= DEEP_DEPTH_USD ? 'Deep' : totalDepthUsd >= THIN_DEPTH_USD ? 'Adequate' : 'Thin'
  const imbalance: ImbalanceState =
    imbalancePct >= 58 ? 'Bid-Heavy' : imbalancePct <= 42 ? 'Ask-Heavy' : 'Balanced'

  // Walls — scan ±3% band; size relative to median in-band level size
  const bidBand = book.bids.filter((l) => l[0] >= mid * (1 - WALL_BAND_PCT))
  const askBand = book.asks.filter((l) => l[0] <= mid * (1 + WALL_BAND_PCT))
  const medSize = median([...bidBand, ...askBand].map((l) => l[1])) || 1
  const wallsRaw: LiquidityZone[] = []
  const scanWalls = (band: Level[], side: 'bid' | 'ask') => {
    for (const [price, size] of band) {
      const mult = size / medSize
      if (mult >= WALL_MULT_NOTABLE) {
        wallsRaw.push({
          side,
          distance_pct: Number((((price - mid) / mid) * 100).toFixed(2)),
          scale: mult >= WALL_MULT_MEGA ? 'Mega' : mult >= WALL_MULT_LARGE ? 'Large' : 'Notable',
        })
      }
    }
  }
  scanWalls(bidBand, 'bid'); scanWalls(askBand, 'ask')
  const walls = wallsRaw
    .sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))
    .slice(0, 4)

  // Voids — adjacent-level price gaps within ±2% that exceed VOID_GAP_PCT
  const voids: LiquidityZone[] = []
  const scanVoids = (band: Level[], side: 'bid' | 'ask') => {
    for (let i = 1; i < band.length && i < 400; i++) {
      const gap = Math.abs(band[i]![0] - band[i - 1]![0]) / mid
      if (gap >= VOID_GAP_PCT) {
        voids.push({ side, distance_pct: Number((((band[i]![0] - mid) / mid) * 100).toFixed(2)), scale: 'Notable' })
        break  // nearest void per side only
      }
    }
  }
  scanVoids(book.bids, 'bid'); scanVoids(book.asks, 'ask')
  const nearestVoids = voids.sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct)).slice(0, 2)

  // Sweep risk — voids near mid (<1.2%) + thin depth = stop-run prone
  const nearVoid = nearestVoids.find((v) => Math.abs(v.distance_pct) < 1.2)
  const sweep_risk: SweepRisk =
    nearVoid && depth_condition === 'Thin' ? 'Elevated' :
    nearVoid || depth_condition === 'Thin' ? 'Moderate' :
    'Low'

  // Manipulation risk — thin book + a single dominant wall = spoof-prone
  const megaWall = walls.find((w) => w.scale === 'Mega')
  const manipulation_risk: ManipulationRisk =
    depth_condition === 'Thin' && megaWall ? 'Elevated' :
    depth_condition === 'Thin' || megaWall ? 'Moderate' : 'Low'

  // Quality score — spread (35%) + depth (40%) + symmetry (25%)
  const spreadComp = Math.max(0, 1 - spreadBps / SPREAD_WIDE_BPS)
  const depthComp  = Math.min(1, totalDepthUsd / DEEP_DEPTH_USD)
  const symComp    = 1 - Math.abs(imbalancePct - 50) / 50
  const quality_score = Math.round(Math.max(0, Math.min(100, (spreadComp * 0.35 + depthComp * 0.40 + symComp * 0.25) * 100)))

  // Execution condition — institutional state
  const execution_condition: ExecutionCondition =
    spread_condition === 'Wide' ? 'Unstable' :
    sweep_risk === 'Elevated'   ? 'Sweep Risk Elevated' :
    depth_condition === 'Thin'  ? 'Thin Liquidity' :
    imbalance !== 'Balanced'    ? 'Imbalanced' :
    'Favorable'

  return {
    symbol:              symbol.toUpperCase(),
    execution_condition,
    spread_condition,
    depth_condition,
    imbalance,
    imbalance_pct:       Math.round(imbalancePct),
    sweep_risk,
    manipulation_risk,
    quality_score,
    walls,
    voids:               nearestVoids,
    narrative:           narrate(symbol, execution_condition, imbalance, sweep_risk, depth_condition),
    partial:             false,
  }
}

function narrate(symbol: string, exec: ExecutionCondition, imb: ImbalanceState, sweep: SweepRisk, depth: DepthCondition): string {
  const tag = symbol.replace(/USDT$/, '')
  const base: Record<ExecutionCondition, string> = {
    'Favorable':           `${tag} execution conditions favorable — deep, balanced book.`,
    'Imbalanced':          `${tag} book ${imb === 'Bid-Heavy' ? 'bid-heavy (buy-side support)' : 'ask-heavy (sell-side pressure)'}.`,
    'Thin Liquidity':      `${tag} liquidity thin — slippage risk on size.`,
    'Sweep Risk Elevated': `${tag} sweep risk elevated — voids near mid, stop-run prone.`,
    'Unstable':            `${tag} spread wide — execution unstable.`,
    'Unknown':             `${tag} order book unavailable.`,
  }
  return base[exec]
}

function emptyAsset(symbol: string): AssetLiquidityView {
  return {
    symbol:              symbol.toUpperCase(),
    execution_condition: 'Unknown',
    spread_condition:    'N/A',
    depth_condition:     'N/A',
    imbalance:           'N/A',
    imbalance_pct:       50,
    sweep_risk:          'N/A',
    manipulation_risk:   'N/A',
    quality_score:       0,
    walls:               [],
    voids:               [],
    narrative:           `${symbol.toUpperCase()} order book unavailable (Coinbase).`,
    partial:             true,
  }
}

// ── Public composer ──────────────────────────────────────────────────────

export async function composeLiquidityBoard(symbols?: string[]): Promise<LiquidityBoard> {
  const generated_at = new Date().toISOString()
  const list = (symbols && symbols.length ? symbols : DEFAULT_BASKET).map((s) => s.toUpperCase())
  const views = await Promise.all(list.map(async (s) => {
    const product = productOf(s)
    if (!product) return emptyAsset(s)
    const book = await fetchBook(product)
    return analyse(s, book)
  }))

  const live = views.filter((v) => v.execution_condition !== 'Unknown')
  const favorable  = live.filter((v) => v.execution_condition === 'Favorable').length
  const sweepRisk  = live.filter((v) => v.execution_condition === 'Sweep Risk Elevated' || v.sweep_risk === 'Elevated').length
  const narrative = live.length === 0
    ? 'Liquidity intelligence unavailable — Coinbase order books unreachable.'
    : `${favorable}/${live.length} assets show favorable execution conditions; ${sweepRisk} flagged for elevated sweep risk.`

  return {
    views,
    summary: { favorable, sweep_risk: sweepRisk, narrative },
    generated_at,
    partial: views.some((v) => v.partial),
  }
}
