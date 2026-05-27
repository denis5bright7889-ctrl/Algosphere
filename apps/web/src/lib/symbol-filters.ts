/**
 * Pure, client-safe filter & sort helpers over the symbol registry.
 *
 * Kept in their own module so the Markets Explorer table can compose
 * them with `useMemo` without dragging in the registry build cost or
 * any server-only imports. Everything here is total + null-safe.
 */
import type {
  SymbolMeta, LiquidityTier, VolatilityTier, ScanPriority, RiskProfile,
} from './symbol-registry'
import type { AssetClass } from './market-universe'

export interface SymbolFilter {
  query?:           string
  assetClass?:      AssetClass | 'all'
  liquidity?:       LiquidityTier | 'all'
  volatility?:      VolatilityTier | 'all'
  scanPriority?:    ScanPriority   | 'all'
  risk?:            RiskProfile    | 'all'
  chartOnly?:       boolean
  signalOnly?:      boolean
  sector?:          string | 'all'
}

export type SortKey = 'symbol' | 'liquidity' | 'volatility' | 'asset' | 'sector'
export type SortDir = 'asc' | 'desc'

const LIQ_RANK: Record<LiquidityTier, number>   = { T1: 0, T2: 1, T3: 2 }
const VOL_RANK: Record<VolatilityTier, number>  = { low: 0, medium: 1, high: 2 }

export function filterSymbols(rows: SymbolMeta[], f: SymbolFilter): SymbolMeta[] {
  const q = f.query?.trim().toLowerCase() ?? ''
  return rows.filter((r) => {
    if (!r.enabled) return false
    if (f.assetClass   && f.assetClass   !== 'all' && r.asset_class    !== f.assetClass)   return false
    if (f.liquidity    && f.liquidity    !== 'all' && r.liquidity_tier !== f.liquidity)    return false
    if (f.volatility   && f.volatility   !== 'all' && r.volatility_tier!== f.volatility)   return false
    if (f.scanPriority && f.scanPriority !== 'all' && r.scan_priority  !== f.scanPriority) return false
    if (f.risk         && f.risk         !== 'all' && r.risk_profile   !== f.risk)         return false
    if (f.chartOnly  && !r.chart_supported)  return false
    if (f.signalOnly && !r.signal_supported) return false
    if (f.sector && f.sector !== 'all' && r.sector !== f.sector)                            return false
    if (q) {
      const hay = (
        r.symbol + ' ' + r.display_name + ' ' + (r.sector ?? '') + ' ' +
        (r.base_asset ?? '') + ' ' + (r.tags.join(' '))
      ).toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function sortSymbols(rows: SymbolMeta[], key: SortKey, dir: SortDir): SymbolMeta[] {
  const m = dir === 'asc' ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    switch (key) {
      case 'symbol':     return a.symbol.localeCompare(b.symbol) * m
      case 'asset':      return a.asset_class.localeCompare(b.asset_class) * m
      case 'sector':     return ((a.sector ?? '~') as string).localeCompare(b.sector ?? '~') * m
      case 'liquidity':  return (LIQ_RANK[a.liquidity_tier]  - LIQ_RANK[b.liquidity_tier])  * m
      case 'volatility': return (VOL_RANK[a.volatility_tier] - VOL_RANK[b.volatility_tier]) * m
    }
  })
  return copy
}

/** Distinct sector list (sorted) — drives the sector filter dropdown. */
export function distinctSectors(rows: SymbolMeta[]): string[] {
  const set = new Set<string>()
  for (const r of rows) if (r.sector) set.add(r.sector)
  return [...set].sort()
}
