/**
 * Sector / group taxonomy for the symbol registry.
 *
 * Crypto sectors are sourced from the existing token-sectors map
 * (single source of truth for Capital Rotation intelligence). Non-crypto
 * sector labels are a small curated table — these are institutional
 * groupings, not derived measurements, so honesty rule = static and
 * clearly catalogued (no fabricated taxonomies).
 *
 * Symbols without a sector mapping return null, never a guess.
 */
import type { AssetClass } from './market-universe'
import { sectorOf as cryptoSectorOf, type Sector as CryptoSector } from './token-sectors'

/** Institutional sector label. Loose string union so non-crypto labels
 *  (Major FX, Energy, …) sit alongside the crypto Sector enum. */
export type SectorLabel =
  | CryptoSector
  | 'Major FX' | 'Minor FX'
  | 'Precious Metals' | 'Energy' | 'Agricultural'
  | 'US Equity' | 'EU Equity' | 'Asia Equity'
  | 'Tech' | 'Auto' | 'Consumer'
  | 'Sovereign Debt'
  | 'Volatility'

// Non-crypto per-symbol sector. Anything missing returns null.
const NON_CRYPTO_SECTOR: Record<string, SectorLabel> = {
  // Forex — majors / minors taxonomy as commonly used institutionally.
  EURUSD: 'Major FX', GBPUSD: 'Major FX', USDJPY: 'Major FX',
  USDCHF: 'Major FX', AUDUSD: 'Major FX', USDCAD: 'Major FX',
  NZDUSD: 'Major FX',
  EURGBP: 'Minor FX', EURJPY: 'Minor FX', GBPJPY: 'Minor FX',

  // Metals & commodities.
  XAUUSD: 'Precious Metals', XAGUSD: 'Precious Metals',
  XPTUSD: 'Precious Metals', XPDUSD: 'Precious Metals',
  USOIL:  'Energy', UKOIL: 'Energy', NATGAS: 'Energy',
  WHEAT:  'Agricultural', CORN: 'Agricultural',
  COFFEE: 'Agricultural', COTTON: 'Agricultural',

  // Equity indices — by region.
  NAS100: 'US Equity', SPX500: 'US Equity', US30: 'US Equity',
  GER40:  'EU Equity', UK100: 'EU Equity',
  JPN225: 'Asia Equity',

  // Stocks — sector tags (kept coarse; finer GICS is a follow-up).
  AAPL: 'Tech', NVDA: 'Tech', MSFT: 'Tech', META: 'Tech',
  AMZN: 'Consumer', TSLA: 'Auto',

  // Futures map to their underlying class.
  ES: 'US Equity', NQ: 'US Equity', YM: 'US Equity',
  CL: 'Energy', GC: 'Precious Metals', SI: 'Precious Metals',

  // Bonds (catalogued).
  US10Y: 'Sovereign Debt', US02Y: 'Sovereign Debt', US30Y: 'Sovereign Debt',
  UK10Y: 'Sovereign Debt', DE10Y: 'Sovereign Debt', JP10Y: 'Sovereign Debt',

  // Volatility.
  VIX: 'Volatility', VVIX: 'Volatility', DVOL: 'Volatility', BVIV: 'Volatility',
}

/** Resolve sector for a symbol. Returns null when not catalogued —
 *  the UI surfaces "—" rather than a guessed bucket. */
export function sectorForSymbol(symbol: string, assetClass: AssetClass): SectorLabel | null {
  const s = symbol.toUpperCase().replace('/', '')
  if (assetClass === 'crypto') {
    // token-sectors keys on the bare base (BTC, ETH, …); strip USDT.
    const base = s.endsWith('USDT') ? s.slice(0, -4)
               : s.endsWith('USDC') ? s.slice(0, -4)
               : s.endsWith('USD')  ? s.slice(0, -3)
               : s
    const sec = cryptoSectorOf(base)
    return sec === 'Other' ? null : sec
  }
  return NON_CRYPTO_SECTOR[s] ?? null
}

/** Coarse asset-class display order for tables / tabs. */
export const ASSET_CLASS_ORDER: AssetClass[] = [
  'crypto', 'forex', 'gold', 'commodities', 'indices', 'stocks',
  'volatility', 'futures', 'bonds',
]

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  crypto: 'Crypto', forex: 'Forex', gold: 'Gold', commodities: 'Commodities',
  indices: 'Indices', stocks: 'Stocks', volatility: 'Volatility',
  futures: 'Futures', bonds: 'Bonds',
}
