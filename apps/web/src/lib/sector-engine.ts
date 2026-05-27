/**
 * Sector intelligence — institutional read of crypto sector rotation.
 *
 * Aggregates the CoinGecko top-250 markets into sectors via the
 * curated `token-sectors` taxonomy (single source of truth for sector
 * mapping; absent = "Other", never guessed). For each sector we emit
 * a state, a breadth read (advancing vs declining), and a one-line
 * narrative the UI can render verbatim.
 *
 * Honesty constraints:
 *  - This is CRYPTO ONLY (CoinGecko is the only free cross-asset
 *    source we have). Non-crypto sectors aren't synthesised.
 *  - We do NOT fabricate ETF flows, institutional ownership, or
 *    dark-pool data. The strength/momentum reads come from public
 *    24h price change aggregated across the sector's constituents.
 *  - Sectors below the minimum-cohort threshold render as
 *    "Insufficient cohort" rather than a low-N misread.
 */
import 'server-only'
import { fetchTop250Markets, type CgMarketCoin } from './cg-markets'
import { sectorOf, SECTOR_LABEL, type Sector } from './token-sectors'

const MIN_COHORT = 4

export type SectorState =
  | 'Accelerating'
  | 'Strengthening'
  | 'Neutral'
  | 'Weakening'
  | 'Distributing'
  | 'Insufficient cohort'

export type Sustainability = 'Healthy' | 'Moderate' | 'Fragile' | 'N/A'
export type RiskLevel      = 'Low' | 'Moderate' | 'Elevated' | 'High' | 'N/A'

export interface SectorRow {
  sector:           Sector
  label:            string
  count:            number          // sample size from CG top 250
  avg_change_24h:   number          // %, rounded
  median_change_24h:number          // %, rounded
  advancing:        number
  declining:        number
  flat:             number
  participation:    number          // 0–100 % advancing
  leaders:          CgMarketCoin[]  // top 3 by 24h change
  laggards:         CgMarketCoin[]  // bottom 3 by 24h change
  state:            SectorState
  sustainability:   Sustainability
  risk_level:       RiskLevel
  narrative:        string
}

export interface SectorIntel {
  sectors:        SectorRow[]
  universe_size:  number     // # coins covered from CG top 250
  generated_at:   string
  partial:        boolean
  reason?:        string
}

// ── Helpers ─────────────────────────────────────────────────────────────

function baseTicker(coin: CgMarketCoin): string {
  return coin.symbol.toUpperCase()
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function classifySector(avg: number, participation: number): SectorState {
  // Two-axis read: momentum (avg change) × breadth (% advancing). A sector
  // distributing if avg is up but breadth is narrow (concentrated rally).
  if (avg >=  4 && participation >= 70) return 'Accelerating'
  if (avg >=  1 && participation >= 55) return 'Strengthening'
  if (avg <= -4 && participation <= 30) return 'Distributing'
  if (avg <= -1 && participation <= 45) return 'Weakening'
  return 'Neutral'
}

function classifySustainability(state: SectorState, participation: number, count: number): Sustainability {
  if (count < MIN_COHORT) return 'N/A'
  if (state === 'Accelerating'  && participation >= 75) return 'Healthy'
  if (state === 'Strengthening' && participation >= 60) return 'Healthy'
  if (state === 'Distributing')                          return 'Fragile'
  if (state === 'Weakening')                             return 'Moderate'
  if (state === 'Neutral')                               return 'Moderate'
  return 'Moderate'
}

function classifyRisk(state: SectorState, avg: number): RiskLevel {
  if (state === 'Insufficient cohort') return 'N/A'
  if (state === 'Accelerating' && avg >= 12) return 'High'        // parabolic risk
  if (state === 'Accelerating')              return 'Elevated'
  if (state === 'Distributing')              return 'High'
  if (state === 'Weakening')                 return 'Elevated'
  if (state === 'Strengthening')             return 'Moderate'
  return 'Low'
}

function narrate(sector: Sector, row: Omit<SectorRow, 'narrative'>): string {
  const name = SECTOR_LABEL[sector]
  if (row.state === 'Insufficient cohort') return `${name}: not enough cohort coverage to read rotation honestly.`
  const dir = row.avg_change_24h >= 0 ? '+' : ''
  const part = `${row.advancing}/${row.count} advancing`
  switch (row.state) {
    case 'Accelerating':
      return `${name} accelerating (${dir}${row.avg_change_24h}% avg, ${part}). Crowding risk rises with persistence.`
    case 'Strengthening':
      return `${name} firming (${dir}${row.avg_change_24h}% avg, ${part}). Healthy breadth supports the move.`
    case 'Distributing':
      return `${name} under distribution (${dir}${row.avg_change_24h}% avg, only ${part}). Risk-off rotation likely.`
    case 'Weakening':
      return `${name} losing momentum (${dir}${row.avg_change_24h}% avg, ${part}). Watch for follow-through.`
    default:
      return `${name} mixed (${dir}${row.avg_change_24h}% avg, ${part}). No clear rotation read.`
  }
}

// ── Composer ────────────────────────────────────────────────────────────

export async function composeSectorIntel(revalidateSeconds = 60): Promise<SectorIntel> {
  const generated_at = new Date().toISOString()
  const result = await fetchTop250Markets(revalidateSeconds)
  if (!result.ok) {
    return { sectors: [], universe_size: 0, generated_at, partial: true, reason: result.reason }
  }

  // Group by curated sector. 'Other' is dropped from the output — we
  // surface only known sectors; Other rolls up as universe_size context.
  const buckets = new Map<Sector, CgMarketCoin[]>()
  let covered = 0
  for (const coin of result.rows) {
    const sec = sectorOf(baseTicker(coin))
    if (sec === 'Other') continue
    covered++
    const arr = buckets.get(sec) ?? []
    arr.push(coin)
    buckets.set(sec, arr)
  }

  const sectors: SectorRow[] = []
  for (const [sec, coins] of buckets) {
    const changes = coins.map((c) => c.price_change_percentage_24h ?? 0)
    const advancing = changes.filter((c) => c >  0).length
    const declining = changes.filter((c) => c <  0).length
    const flat      = changes.filter((c) => c === 0).length
    const avg = coins.length > 0
      ? changes.reduce((s, v) => s + v, 0) / coins.length
      : 0
    const med = median(changes)
    const participation = coins.length > 0 ? Math.round((advancing / coins.length) * 100) : 0

    const sortedByChange = [...coins].sort(
      (a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0),
    )

    const baseRow = {
      sector: sec,
      label:  SECTOR_LABEL[sec],
      count:  coins.length,
      avg_change_24h:    Number(avg.toFixed(2)),
      median_change_24h: Number(med.toFixed(2)),
      advancing, declining, flat,
      participation,
      leaders:  sortedByChange.slice(0, 3),
      laggards: sortedByChange.slice(-3).reverse(),
    }

    const state = coins.length < MIN_COHORT
      ? 'Insufficient cohort' as const
      : classifySector(baseRow.avg_change_24h, participation)
    const sustainability = classifySustainability(state, participation, coins.length)
    const risk_level     = classifyRisk(state, baseRow.avg_change_24h)
    const narrative      = narrate(sec, { ...baseRow, state, sustainability, risk_level })

    sectors.push({ ...baseRow, state, sustainability, risk_level, narrative })
  }

  // Strongest first — accelerating sectors lead.
  sectors.sort((a, b) => b.avg_change_24h - a.avg_change_24h)

  return { sectors, universe_size: covered, generated_at, partial: false }
}
