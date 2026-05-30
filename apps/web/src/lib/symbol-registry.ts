/**
 * Dynamic symbol registry — the institutional metadata layer.
 *
 * Composes the canonical `MARKET_UNIVERSE` (the typed taxonomy of what
 * we cover) with per-symbol institutional metadata (sector, liquidity /
 * volatility tiers, scan priority, tags, provider routes, risk profile,
 * supported timeframes, TradingView mapping). One source of truth that
 * Markets Explorer, the chart modal, and downstream intelligence
 * surfaces all read from.
 *
 * Honesty:
 *  - Sector / tiers / risk profile are STATIC institutional taxonomy
 *    (curated, documented), not derived measurements. The UI labels
 *    them accordingly — these are catalog metadata, not real-time data.
 *  - Provider routes describe the chain that COULD serve an asset
 *    class; runtime liveness is computed separately via `configuredProviders()`.
 *  - `chart_supported` mirrors `isChartable()` — single source of truth.
 *  - `signal_supported` reflects whether the signal engine scans this
 *    symbol (catalogued only — the engine config is the authority).
 */
import {
  MARKET_UNIVERSE, type AssetClass, type Instrument, type Provider,
} from './market-universe'
import { isChartable, toTradingViewSymbol } from './tradingview'
import { sectorForSymbol, type SectorLabel } from './symbol-groups'

// ── Public types ────────────────────────────────────────────────────────

export type LiquidityTier  = 'T1' | 'T2' | 'T3'
export type VolatilityTier = 'low' | 'medium' | 'high'
export type ScanPriority   = 'real-time' | 'standard' | 'opportunistic'
export type RiskProfile    = 'core' | 'standard' | 'speculative'

/** Provider chain name used by the routing layer. Distinct from the
 *  Universe `Provider` union (which is the *primary* quote provider). */
export type ProviderRoute = 'binance' | 'coinbase' | 'coingecko'
  | 'twelvedata' | 'alphavantage' | 'polygon' | 'finnhub'

export interface SymbolMeta {
  symbol:               string
  display_name:         string
  asset_class:          AssetClass
  exchange:             string | null
  sector:               SectorLabel | null
  base_asset:           string | null
  quote_asset:          string | null
  tradingview_symbol:   string | null
  supported_timeframes: string[]
  scan_priority:        ScanPriority
  liquidity_tier:       LiquidityTier
  volatility_tier:      VolatilityTier
  chart_supported:      boolean
  signal_supported:     boolean
  enabled:              boolean
  tags:                 string[]
  provider_routes:      ProviderRoute[]
  risk_profile:         RiskProfile
}

// ── Per-class defaults ──────────────────────────────────────────────────

const TIMEFRAMES_BY_CLASS: Record<AssetClass, string[]> = {
  crypto:      ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
  forex:       ['5m', '15m', '1h', '4h', '1d', '1w'],
  gold:        ['5m', '15m', '1h', '4h', '1d', '1w'],
  indices:     ['15m', '1h', '4h', '1d', '1w'],
  stocks:      ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
  commodities: ['15m', '1h', '4h', '1d', '1w'],
  futures:     ['15m', '1h', '4h', '1d', '1w'],
  bonds:       ['1d', '1w'],
  volatility:  ['1h', '4h', '1d', '1w'],
}

const ROUTES_BY_CLASS: Record<AssetClass, ProviderRoute[]> = {
  crypto:      ['binance', 'coinbase', 'coingecko'],
  forex:       ['twelvedata', 'alphavantage'],
  gold:        ['twelvedata', 'alphavantage'],
  indices:     ['twelvedata', 'polygon', 'finnhub'],
  stocks:      ['finnhub', 'twelvedata'],
  commodities: ['twelvedata'],
  futures:     [],
  bonds:       [],
  volatility:  ['twelvedata'],
}

const VOL_DEFAULT_BY_CLASS: Record<AssetClass, VolatilityTier> = {
  crypto: 'high', forex: 'low', gold: 'medium', indices: 'medium',
  stocks: 'medium', commodities: 'medium', futures: 'medium',
  bonds: 'low', volatility: 'high',
}

// User-facing exchange/source labels. Internal provider keys stay
// (twelvedata / finnhub / crypto-stream), but the displayed label
// is rebranded so users see one cohesive data fabric, not a vendor list.
const EXCHANGE_BY_PROVIDER: Record<NonNullable<Provider>, string> = {
  'crypto-stream': 'AlgoSphere',
  'twelvedata':    'AlgoSphere',
  'finnhub':       'AlgoSphere',
}

// ── Per-symbol overrides (curated institutional metadata) ───────────────
//
// Keys: symbol; values are partial — anything omitted uses the per-class
// defaults above. These overrides represent the institutional tiering we
// use elsewhere (BTC/ETH/EURUSD/XAUUSD/SPX500 = core liquidity; meme +
// micro-cap alts = speculative). They are STATIC; if the universe changes
// materially we revise this map deliberately.

interface Overrides {
  liquidity_tier?:  LiquidityTier
  volatility_tier?: VolatilityTier
  scan_priority?:   ScanPriority
  risk_profile?:    RiskProfile
  tags?:            string[]
}

const OVERRIDES: Record<string, Overrides> = {
  // Crypto majors — T1 / core / real-time.
  BTCUSDT: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'real-time', risk_profile: 'core',     tags: ['major', 'reserve'] },
  ETHUSDT: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'real-time', risk_profile: 'core',     tags: ['major', 'smart-contracts'] },
  SOLUSDT: { liquidity_tier: 'T1', volatility_tier: 'high',   scan_priority: 'real-time', risk_profile: 'standard', tags: ['major', 'l1'] },
  BNBUSDT: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard',  risk_profile: 'standard', tags: ['cex'] },
  XRPUSDT: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard',  risk_profile: 'standard', tags: ['payments'] },
  ADAUSDT: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'standard',  risk_profile: 'standard' },
  DOGEUSDT:{ liquidity_tier: 'T2', volatility_tier: 'high',   scan_priority: 'standard',  risk_profile: 'speculative', tags: ['meme'] },
  AVAXUSDT:{ liquidity_tier: 'T2', volatility_tier: 'high',   scan_priority: 'standard',  risk_profile: 'standard' },
  LINKUSDT:{ liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'standard',  risk_profile: 'standard', tags: ['oracle'] },
  LTCUSDT: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'opportunistic', risk_profile: 'standard' },
  DOTUSDT: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'opportunistic', risk_profile: 'standard' },
  ARBUSDT: { liquidity_tier: 'T2', volatility_tier: 'high',   scan_priority: 'opportunistic', risk_profile: 'standard', tags: ['l2'] },
  OPUSDT:  { liquidity_tier: 'T2', volatility_tier: 'high',   scan_priority: 'opportunistic', risk_profile: 'standard', tags: ['l2'] },
  PEPEUSDT:{ liquidity_tier: 'T3', volatility_tier: 'high',   scan_priority: 'opportunistic', risk_profile: 'speculative', tags: ['meme'] },
  SUIUSDT: { liquidity_tier: 'T2', volatility_tier: 'high',   scan_priority: 'opportunistic', risk_profile: 'standard' },
  TONUSDT: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'opportunistic', risk_profile: 'standard' },

  // Forex majors — T1 / core; minors / crosses T2.
  EURUSD: { liquidity_tier: 'T1', volatility_tier: 'low',    scan_priority: 'real-time', risk_profile: 'core',     tags: ['major', 'g7'] },
  GBPUSD: { liquidity_tier: 'T1', volatility_tier: 'low',    scan_priority: 'real-time', risk_profile: 'core',     tags: ['major', 'g7'] },
  USDJPY: { liquidity_tier: 'T1', volatility_tier: 'low',    scan_priority: 'real-time', risk_profile: 'core',     tags: ['major', 'g7'] },
  USDCHF: { liquidity_tier: 'T1', volatility_tier: 'low',    scan_priority: 'standard',  risk_profile: 'core',     tags: ['major', 'safe-haven'] },
  AUDUSD: { liquidity_tier: 'T1', volatility_tier: 'low',    scan_priority: 'standard',  risk_profile: 'standard', tags: ['major'] },
  USDCAD: { liquidity_tier: 'T1', volatility_tier: 'low',    scan_priority: 'standard',  risk_profile: 'standard', tags: ['major'] },
  NZDUSD: { liquidity_tier: 'T2', volatility_tier: 'low',    scan_priority: 'opportunistic', risk_profile: 'standard', tags: ['major'] },
  EURGBP: { liquidity_tier: 'T2', volatility_tier: 'low',    scan_priority: 'opportunistic', risk_profile: 'standard', tags: ['cross'] },
  EURJPY: { liquidity_tier: 'T2', volatility_tier: 'low',    scan_priority: 'opportunistic', risk_profile: 'standard', tags: ['cross'] },
  GBPJPY: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'opportunistic', risk_profile: 'standard', tags: ['cross', 'high-beta'] },

  // Gold — flagship metal.
  XAUUSD: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'real-time', risk_profile: 'core', tags: ['safe-haven', 'spot'] },

  // Indices — T1 (US benchmarks) / T2 (EU/Asia).
  SPX500: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'real-time', risk_profile: 'core', tags: ['benchmark'] },
  NAS100: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'real-time', risk_profile: 'core', tags: ['benchmark', 'tech-heavy'] },
  US30:   { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard',  risk_profile: 'core' },
  GER40:  { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'standard',  risk_profile: 'core' },
  UK100:  { liquidity_tier: 'T2', volatility_tier: 'low',    scan_priority: 'opportunistic', risk_profile: 'core' },
  JPN225: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'opportunistic', risk_profile: 'core' },

  // Stocks — US large-caps.
  AAPL: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard', risk_profile: 'core' },
  NVDA: { liquidity_tier: 'T1', volatility_tier: 'high',   scan_priority: 'standard', risk_profile: 'standard', tags: ['ai', 'high-beta'] },
  TSLA: { liquidity_tier: 'T1', volatility_tier: 'high',   scan_priority: 'standard', risk_profile: 'standard', tags: ['high-beta'] },
  MSFT: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard', risk_profile: 'core' },
  META: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard', risk_profile: 'standard' },
  AMZN: { liquidity_tier: 'T1', volatility_tier: 'medium', scan_priority: 'standard', risk_profile: 'standard' },

  // Commodities & energy.
  USOIL:  { liquidity_tier: 'T1', volatility_tier: 'high',   scan_priority: 'standard', risk_profile: 'core', tags: ['benchmark'] },
  UKOIL:  { liquidity_tier: 'T2', volatility_tier: 'high',   scan_priority: 'opportunistic', risk_profile: 'core' },
  XAGUSD: { liquidity_tier: 'T1', volatility_tier: 'high',   scan_priority: 'standard', risk_profile: 'standard' },
  XPTUSD: { liquidity_tier: 'T2', volatility_tier: 'medium', scan_priority: 'opportunistic', risk_profile: 'standard' },
  XPDUSD: { liquidity_tier: 'T3', volatility_tier: 'high',   scan_priority: 'opportunistic', risk_profile: 'speculative' },

  // Volatility — VIX is core macro signal.
  VIX:  { liquidity_tier: 'T1', volatility_tier: 'high', scan_priority: 'real-time', risk_profile: 'core', tags: ['macro', 'fear-gauge'] },
}

// ── Symbols the signal engine scans (mirrors the engine default config).
// Single source of truth for "signal_supported" — engine config is the
// real authority; this catalogue is the readable mirror.
const SIGNAL_UNIVERSE = new Set<string>([
  'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD',
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'LTCUSDT', 'DOTUSDT',
  'ARBUSDT', 'BNBUSDT', 'OPUSDT', 'PEPEUSDT', 'SUIUSDT', 'TONUSDT',
])

// ── Base/quote inference ─────────────────────────────────────────────────

function splitCryptoPair(symbol: string): [string | null, string | null] {
  const s = symbol.toUpperCase()
  if (s.endsWith('USDT')) return [s.slice(0, -4), 'USDT']
  if (s.endsWith('USDC')) return [s.slice(0, -4), 'USDC']
  if (s.endsWith('USD'))  return [s.slice(0, -3), 'USD']
  return [s, null]
}
function splitForexPair(symbol: string): [string | null, string | null] {
  const s = symbol.toUpperCase().replace('/', '')
  return s.length === 6 ? [s.slice(0, 3), s.slice(3)] : [null, null]
}

function inferBaseQuote(inst: Instrument): [string | null, string | null] {
  switch (inst.assetClass) {
    case 'crypto':      return splitCryptoPair(inst.symbol)
    case 'forex':       return splitForexPair(inst.symbol)
    case 'gold':        return ['XAU', 'USD']
    case 'commodities':
    case 'volatility':  return [inst.symbol, null]
    case 'indices':
    case 'stocks':
    case 'futures':     return [inst.symbol, null]
    case 'bonds':       return [inst.symbol, null]
    default:            return [null, null]
  }
}

// ── Build the registry ──────────────────────────────────────────────────

function buildOne(inst: Instrument): SymbolMeta {
  const ov = OVERRIDES[inst.symbol.toUpperCase()] ?? {}
  const [base, quote] = inferBaseQuote(inst)
  const tv = toTradingViewSymbol(inst.symbol, inst.assetClass)
  const exch = inst.provider ? EXCHANGE_BY_PROVIDER[inst.provider] : null

  return {
    symbol:               inst.symbol,
    display_name:         inst.label,
    asset_class:          inst.assetClass,
    exchange:             exch,
    sector:               sectorForSymbol(inst.symbol, inst.assetClass),
    base_asset:           base,
    quote_asset:          quote,
    tradingview_symbol:   tv,
    supported_timeframes: TIMEFRAMES_BY_CLASS[inst.assetClass],
    scan_priority:        ov.scan_priority   ?? 'opportunistic',
    liquidity_tier:       ov.liquidity_tier  ?? 'T3',
    volatility_tier:      ov.volatility_tier ?? VOL_DEFAULT_BY_CLASS[inst.assetClass],
    chart_supported:      isChartable(inst.symbol, inst.assetClass),
    signal_supported:     SIGNAL_UNIVERSE.has(inst.symbol.toUpperCase()),
    enabled:              true,
    tags:                 ov.tags         ?? [],
    provider_routes:      ROUTES_BY_CLASS[inst.assetClass],
    risk_profile:         ov.risk_profile ?? (inst.assetClass === 'crypto' ? 'standard' : 'standard'),
  }
}

let _registry: SymbolMeta[] | null = null

/** Full registry — built once, memoised. ~70 instruments in the
 *  current universe; expands as MARKET_UNIVERSE / OVERRIDES grow. */
export function symbolRegistry(): SymbolMeta[] {
  if (!_registry) {
    _registry = MARKET_UNIVERSE.flatMap((c) => c.instruments.map(buildOne))
  }
  return _registry
}

export function symbolByCode(symbol: string): SymbolMeta | undefined {
  const s = symbol.toUpperCase()
  return symbolRegistry().find((m) => m.symbol.toUpperCase() === s)
}

export function symbolsByClass(assetClass: AssetClass): SymbolMeta[] {
  return symbolRegistry().filter((m) => m.asset_class === assetClass)
}

export const REGISTRY_SIZE = () => symbolRegistry().length
