/**
 * Volatility intelligence.
 *
 * Two clearly-separated reads:
 *  1. LIVE ENGINE volatility — `regime_snapshots.atr_pct` per scanned
 *     symbol, ranked. This is real measured volatility on the engine's
 *     timeframe — labelled "live engine" in the UI.
 *  2. STATIC REGISTRY tiers — the curated `volatility_tier` per symbol
 *     from #42. Catalog metadata, not a measurement. Labelled "static
 *     catalog" in the UI.
 *
 * Mixing the two without labels would be dishonest; the composer keeps
 * them split so the page can never present the catalog tier as if it
 * were a live read.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { symbolByCode, symbolRegistry } from './symbol-registry'
import { volatilityLevel, type VolLevel } from './market-language'
import type { SymbolMeta, VolatilityTier } from './symbol-registry'

export interface LiveVolRow {
  symbol:         string
  display_name:   string
  asset_class:    string
  atr_pct:        number      // fraction (e.g. 0.0123 = 1.23%)
  level:          VolLevel    // translated label
  scanned_at:     string
}

export interface CatalogVolRow {
  symbol:         string
  display_name:   string
  asset_class:    string
  tier:           VolatilityTier
}

export interface VolatilityView {
  live:               LiveVolRow[]       // ranked desc by atr_pct
  live_engine_count:  number
  catalog_by_tier:    Record<VolatilityTier, CatalogVolRow[]>
  catalog_size:       number
  generated_at:       string
  partial:            boolean
  reason?:            string
}

export async function composeVolatilityView(): Promise<VolatilityView> {
  const generated_at = new Date().toISOString()
  const supabase = await createClient()

  // ── Live engine ATR ───────────────────────────────────────────────
  const { data: snaps, error } = await supabase
    .from('regime_snapshots')
    .select('symbol, atr_pct, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(300)

  const seen = new Set<string>()
  const live: LiveVolRow[] = []
  for (const r of snaps ?? []) {
    if (seen.has(r.symbol)) continue
    seen.add(r.symbol)
    const meta = symbolByCode(r.symbol)
    const display = meta?.display_name ?? r.symbol
    const ac      = meta?.asset_class  ?? '—'
    if (typeof r.atr_pct !== 'number' || !Number.isFinite(r.atr_pct)) continue
    live.push({
      symbol: r.symbol,
      display_name: display,
      asset_class: ac,
      atr_pct: r.atr_pct,
      level:  volatilityLevel(r.atr_pct),
      scanned_at: r.scanned_at,
    })
  }
  live.sort((a, b) => b.atr_pct - a.atr_pct)

  // ── Static registry tiers ─────────────────────────────────────────
  const cat = symbolRegistry()
  const catalog_by_tier: Record<VolatilityTier, CatalogVolRow[]> = { high: [], medium: [], low: [] }
  for (const m of cat) {
    if (!m.enabled) continue
    catalog_by_tier[m.volatility_tier].push(asCatalogRow(m))
  }
  // Within tier, sort by symbol for stable layout.
  (Object.keys(catalog_by_tier) as VolatilityTier[]).forEach((k) => {
    catalog_by_tier[k].sort((a, b) => a.symbol.localeCompare(b.symbol))
  })

  return {
    live,
    live_engine_count: live.length,
    catalog_by_tier,
    catalog_size: cat.length,
    generated_at,
    partial: !!error,
    reason: error?.message,
  }
}

function asCatalogRow(m: SymbolMeta): CatalogVolRow {
  return {
    symbol: m.symbol,
    display_name: m.display_name,
    asset_class: m.asset_class,
    tier: m.volatility_tier,
  }
}
