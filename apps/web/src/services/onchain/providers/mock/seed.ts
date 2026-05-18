/**
 * Deterministic seeded generators for the mock on-chain provider.
 *
 * Same seed → same data every call, so the UI is stable in dev/demo
 * and screenshots don't churn. Every record is clearly synthetic;
 * the provider name ('mock') is surfaced in every API envelope so a
 * mock response can never be mistaken for live intelligence.
 */
import type {
  Chain, SmartMoneyBuy, WhaleFlow, ExchangeFlow, StablecoinFlow,
  LiquidityShift, TokenMomentum, SectorRotation, HeatmapCell,
} from '../../types'

export function rng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CHAINS: Chain[] = ['ethereum', 'solana', 'base', 'arbitrum', 'polygon', 'bsc']
const TOKENS = [
  'WIF', 'AI16Z', 'PENGU', 'VIRTUAL', 'AERO', 'ENA', 'ONDO', 'JUP', 'PYTH', 'TIA',
  'EIGEN', 'ZRO', 'ETHFI', 'REZ', 'W', 'STRK', 'JTO', 'DRIFT', 'MEW', 'POPCAT',
] as const
const SECTORS = ['AI', 'DeFi', 'Meme', 'RWA', 'L2', 'Infra', 'Gaming', 'Privacy']
const EXCHANGES = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Upbit']
const WALLET_LABELS = [
  'Cobie', 'GCR', 'Tetranode', 'DeFiGod', 'Ansem', 'Hsaka', 'Smart LP #14',
  'Jump Trading', 'Wintermute', 'Whale 0x4f…2a1', 'Whale 0x9c…f30', null, null,
]
const PROTOCOLS = ['Uniswap v3', 'Aave v3', 'Curve', 'Spark', 'Pendle', 'Aerodrome', 'Jupiter']

const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!
const addr = (r: () => number) =>
  '0x' + Array.from({ length: 6 }, () => Math.floor(r() * 16).toString(16)).join('') + '…'
const isoAgo = (r: () => number) =>
  new Date(Date.now() - Math.floor(r() * 86_400_000)).toISOString()

export function smartMoney(seed: number, n: number): SmartMoneyBuy[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => ({
    id:             `sm-${seed}-${i}`,
    chain:          pick(r, CHAINS),
    token_symbol:   pick(r, TOKENS),
    token_address:  addr(r),
    wallet_address: addr(r),
    wallet_label:   pick(r, WALLET_LABELS),
    amount_usd:     Math.round(15_000 + r() * 4_000_000),
    price_usd:      +(r() * 12).toFixed(4),
    conviction:     +(0.45 + r() * 0.55).toFixed(2),
    sector:         pick(r, SECTORS),
    observed_at:    isoAgo(r),
  })).sort((a, b) => b.amount_usd - a.amount_usd)
}

export function whaleFlows(seed: number, n: number): WhaleFlow[] {
  const r = rng(seed)
  const dirs = ['in', 'out', 'accumulate', 'distribute'] as const
  return Array.from({ length: n }, (_, i) => {
    const amt = Math.round(80_000 + r() * 12_000_000)
    return {
      id:             `wf-${seed}-${i}`,
      chain:          pick(r, CHAINS),
      token_symbol:   pick(r, TOKENS),
      token_address:  addr(r),
      direction:      pick(r, dirs),
      from_label:     pick(r, WALLET_LABELS),
      to_label:       pick(r, [...WALLET_LABELS, 'Binance Hot Wallet', 'Coinbase Prime']),
      amount_usd:     amt,
      amount_token:   Math.round(amt / (0.2 + r() * 9)),
      is_smart_money: r() > 0.45,
      observed_at:    isoAgo(r),
    }
  }).sort((a, b) => b.amount_usd - a.amount_usd)
}

export function exchangeFlows(seed: number): ExchangeFlow[] {
  const r = rng(seed)
  return EXCHANGES.flatMap((exchange) =>
    (['ethereum', 'solana', 'base'] as Chain[]).map((chain) => {
      const inflow  = Math.round(2_000_000 + r() * 90_000_000)
      const outflow = Math.round(2_000_000 + r() * 90_000_000)
      return {
        exchange,
        chain,
        inflow_usd:    inflow,
        outflow_usd:   outflow,
        net_flow_usd:  inflow - outflow,
        delta_24h_pct: +((r() - 0.5) * 0.6).toFixed(3),
      }
    }),
  ).sort((a, b) => a.net_flow_usd - b.net_flow_usd)
}

export function stablecoins(seed: number): StablecoinFlow[] {
  const r = rng(seed)
  const stables = ['USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD'] as const
  return stables.flatMap((stable) =>
    (['ethereum', 'solana', 'base', 'arbitrum'] as Chain[]).map((chain) => {
      const mint = Math.round(r() * 400_000_000)
      const burn = Math.round(r() * 380_000_000)
      return {
        stable, chain,
        mint_usd:        mint,
        burn_usd:        burn,
        net_inflow_usd:  mint - burn,
        delta_supply_pct: +((r() - 0.45) * 0.12).toFixed(4),
      }
    }),
  ).sort((a, b) => b.net_inflow_usd - a.net_inflow_usd)
}

export function liquidityShifts(seed: number): LiquidityShift[] {
  const r = rng(seed)
  return PROTOCOLS.map((protocol) => {
    const tvl   = Math.round(50_000_000 + r() * 4_000_000_000)
    const dPct  = +((r() - 0.45) * 0.3).toFixed(3)
    return {
      chain:         pick(r, CHAINS),
      protocol,
      tvl_usd:       tvl,
      tvl_delta_usd: Math.round(tvl * dPct),
      tvl_delta_pct: dPct,
    }
  }).sort((a, b) => b.tvl_delta_pct - a.tvl_delta_pct)
}

export function tokenMomentum(seed: number, n: number): TokenMomentum[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => ({
    chain:                    pick(r, CHAINS),
    token_symbol:             TOKENS[i % TOKENS.length]!,
    token_address:            addr(r),
    inflow_usd:               Math.round(50_000 + r() * 8_000_000),
    volume_delta_pct:         +((r() * 4) - 0.4).toFixed(2),
    wallet_growth_pct:        +((r() * 1.6) - 0.2).toFixed(2),
    smart_money_exposure_pct: +(r() * 0.65).toFixed(2),
    momentum_score:           Math.round(20 + r() * 80),
  })).sort((a, b) => b.momentum_score - a.momentum_score)
}

export function marketRotation(seed: number): SectorRotation[] {
  const r = rng(seed)
  const narr: Record<string, string> = {
    AI:      'AI agents leading flows; capital rotating out of majors',
    DeFi:    'Stable DeFi yields drawing steady inflows',
    Meme:    'Meme velocity cooling after parabolic week',
    RWA:     'RWA accumulation accelerating on institutional desks',
    L2:      'L2 incentives pulling liquidity from L1',
    Infra:   'Infra tokens consolidating, low conviction',
    Gaming:  'Gaming flat — awaiting catalyst',
    Privacy: 'Privacy names quietly accumulated by smart money',
  }
  return SECTORS.map((sector) => {
    const flow = Math.round((r() - 0.45) * 220_000_000)
    return {
      sector,
      capital_flow_usd: flow,
      strength_score:   Math.round(15 + r() * 85),
      delta_7d_pct:     +((r() - 0.45) * 0.8).toFixed(3),
      narrative:        narr[sector] ?? null,
    }
  }).sort((a, b) => b.strength_score - a.strength_score)
}

export function heatmap(seed: number): HeatmapCell[] {
  const r = rng(seed)
  const metrics = ['liquidity', 'activity', 'inflow', 'smart_money'] as const
  const chains: Chain[] = ['ethereum', 'solana', 'base', 'arbitrum', 'polygon', 'bsc']
  return chains.flatMap((chain) =>
    metrics.map((metric) => ({
      chain,
      metric,
      value:   +(r()).toFixed(3),
      raw_usd: Math.round(r() * 900_000_000),
    })),
  )
}
