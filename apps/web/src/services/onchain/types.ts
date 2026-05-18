/**
 * On-chain intelligence — provider contract.
 *
 * The Intelligence UI (smart-money / whale-flows / exchange-flows /
 * stablecoin-liquidity / token-momentum / market-rotation / heatmap)
 * NEVER reaches into a specific data source. Every page asks an
 * `OnchainProvider` for typed records and renders them.
 *
 * Implementations live in `./providers/<name>/`. The factory in
 * `./index.ts` resolves the active provider from
 * `process.env.ONCHAIN_PROVIDER` (defaults to 'mock'), so swapping
 * Dune → Birdeye → Moralis → an internal indexer is a one-line
 * deploy change — no UI rewrite.
 */

export type Chain = 'ethereum' | 'solana' | 'base' | 'arbitrum' | 'polygon' | 'bsc' | 'optimism'
export type Window = '1h' | '24h' | '7d' | '30d'

export interface Query {
  chains?: Chain[]
  window?: Window
  limit?:  number
}

// ── Records ──────────────────────────────────────────────────────

export interface SmartMoneyBuy {
  id:               string
  chain:            Chain
  token_symbol:     string
  token_address:    string
  wallet_address:   string
  wallet_label:     string | null      // 'Cobie', 'GCR', etc. when known
  amount_usd:       number
  price_usd:        number
  conviction:       number | null      // 0..1 confidence/quality score; null = source provided none (UI must show "Unrated", never a fabricated midpoint)
  sector:           string | null      // 'AI', 'DeFi', 'L2', 'Meme', 'RWA', etc.
  observed_at:      string             // ISO timestamp
}

export interface WhaleFlow {
  id:               string
  chain:            Chain
  token_symbol:     string
  token_address:    string
  direction:        'in' | 'out' | 'accumulate' | 'distribute' | 'unknown' // 'unknown' = source had no direction column / CEX labels; never guessed
  from_label:       string | null      // 'Binance Hot Wallet', 'Whale 0x4f...'
  to_label:         string | null
  amount_usd:       number
  amount_token:     number
  is_smart_money:   boolean
  observed_at:      string
}

export interface ExchangeFlow {
  exchange:         string             // 'Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit'
  chain:            Chain
  net_flow_usd:     number             // positive = inflow to exchange (sell pressure), negative = outflow (accum)
  inflow_usd:       number
  outflow_usd:      number
  delta_24h_pct:    number             // change vs prior period (0..1 signed ratio)
}

export interface StablecoinFlow {
  stable:           'USDT' | 'USDC' | 'DAI' | 'FDUSD' | 'PYUSD'
  chain:            Chain
  net_inflow_usd:   number
  mint_usd:         number
  burn_usd:         number
  delta_supply_pct: number             // 0..1 signed
}

export interface LiquidityShift {
  chain:            Chain
  protocol:         string             // 'Uniswap v3', 'Curve', 'Aave', 'Spark'
  tvl_usd:          number
  tvl_delta_usd:    number
  tvl_delta_pct:    number             // signed ratio
}

export interface TokenMomentum {
  chain:            Chain
  token_symbol:     string
  token_address:    string
  inflow_usd:       number
  volume_delta_pct: number             // signed ratio
  wallet_growth_pct: number            // signed ratio (unique holders)
  smart_money_exposure_pct: number     // 0..1 — share of SM wallets holding
  momentum_score:   number             // 0..100 composite
}

export interface SectorRotation {
  sector:           string             // 'AI', 'DeFi', 'Meme', 'RWA', 'L2', 'Infra', 'Gaming', 'Privacy'
  capital_flow_usd: number             // signed
  strength_score:   number             // 0..100
  delta_7d_pct:     number             // signed ratio
  narrative:        string | null      // short AI summary, ≤14 words
}

export interface HeatmapCell {
  chain:            Chain
  metric:           'liquidity' | 'activity' | 'inflow' | 'smart_money'
  value:            number             // 0..1 normalised intensity
  raw_usd?:         number             // optional underlying $ amount
}

// ── Optional AI overlay surfaces ─────────────────────────────────

export interface ProviderNarrative {
  surface:          'smart-money' | 'whale-flows' | 'exchange-flows'
                    | 'stablecoin-liquidity' | 'token-momentum'
                    | 'market-rotation' | 'heatmap'
  body:             string             // 2-3 short sentences
  generated_at:     string
}

// ── Common envelope ──────────────────────────────────────────────

export interface Envelope<T> {
  data:        T[]
  source:      string                  // provider name — never trusted by UI, surfaced for transparency
  fetched_at:  string                  // ISO
  /** True when entitlements forced a delayed / down-sampled response. */
  delayed:     boolean
}

// ── Provider interface ───────────────────────────────────────────

export interface OnchainProvider {
  /** Identifier for logs / footers. Never used for control flow. */
  readonly name: string

  getSmartMoneyBuys(q?:    Query): Promise<SmartMoneyBuy[]>
  getWhaleFlows(q?:        Query): Promise<WhaleFlow[]>
  getExchangeFlows(q?:     Query): Promise<ExchangeFlow[]>
  getStablecoinInflows(q?: Query): Promise<StablecoinFlow[]>
  getLiquidityShifts(q?:   Query): Promise<LiquidityShift[]>
  getTokenMomentum(q?:     Query): Promise<TokenMomentum[]>
  getMarketRotation(q?:    Query): Promise<SectorRotation[]>
  getHeatmap(q?:           Query): Promise<HeatmapCell[]>

  /** Optional narrative — providers without AI overlays return null. */
  getNarrative?(surface: ProviderNarrative['surface'], q?: Query): Promise<ProviderNarrative | null>
}
