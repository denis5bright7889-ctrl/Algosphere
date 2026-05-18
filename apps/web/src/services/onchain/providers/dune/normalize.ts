/**
 * Dune row → typed-record normalisers.
 *
 * Dune query authors choose their own column names; this layer accepts
 * the common conventional variants for each field rather than locking
 * the user into one schema. A row that's missing a required column is
 * dropped — never silently zeroed — so the consumer never sees a
 * fabricated number.
 *
 * The contract each surface expects is documented inline below; the
 * full schema reference (with copy-paste example SELECT) lives at
 * src/services/onchain/providers/dune/README.md.
 */

import type {
  Chain, SmartMoneyBuy, WhaleFlow, ExchangeFlow, StablecoinFlow,
  TokenMomentum,
} from '../../types'
import type { DuneRow } from '@/lib/dune'

const CHAINS: readonly Chain[] = [
  'ethereum', 'solana', 'base', 'arbitrum', 'polygon', 'bsc', 'optimism',
] as const

// ─── Flexible column accessors ──────────────────────────────────────

/** Returns the first non-null value found for any of the given keys (case-insensitive). */
function pick(row: DuneRow, keys: readonly string[]): unknown {
  const lower: Record<string, unknown> = {}
  for (const k of Object.keys(row)) lower[k.toLowerCase()] = row[k]
  for (const k of keys) {
    const v = lower[k.toLowerCase()]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

function str(row: DuneRow, keys: readonly string[]): string | null {
  const v = pick(row, keys)
  if (v == null) return null
  return String(v)
}

function num(row: DuneRow, keys: readonly string[]): number | null {
  const v = pick(row, keys)
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function bool(row: DuneRow, keys: readonly string[]): boolean | null {
  const v = pick(row, keys)
  if (v == null) return null
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase()
  if (['true', 't', '1', 'yes', 'y'].includes(s)) return true
  if (['false', 'f', '0', 'no', 'n'].includes(s)) return false
  return null
}

function asChain(value: string | null): Chain | null {
  if (!value) return null
  const v = value.toLowerCase().trim()
  return (CHAINS as readonly string[]).includes(v) ? (v as Chain) : null
}

function asIso(value: string | null): string | null {
  if (!value) return null
  // Accept either ISO strings or epoch ms/seconds.
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e12 ? n : n * 1000
    return new Date(ms).toISOString()
  }
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// ─── Per-surface row mappers ────────────────────────────────────────

/**
 * Smart Money buys.
 * Required columns: chain, token_symbol, token_address, wallet_address, amount_usd, observed_at.
 * Optional: wallet_label, price_usd, conviction (0..1), sector.
 */
export function mapSmartMoneyRow(row: DuneRow, idx: number): SmartMoneyBuy | null {
  const chain = asChain(str(row, ['chain', 'blockchain', 'network']))
  const symbol = str(row, ['token_symbol', 'symbol', 'token'])
  const addr = str(row, ['token_address', 'contract_address', 'address'])
  const wallet = str(row, ['wallet_address', 'wallet', 'buyer', 'trader_address'])
  const amount = num(row, ['amount_usd', 'usd_amount', 'usd_value', 'value_usd'])
  const observed = asIso(str(row, ['observed_at', 'block_time', 'timestamp', 'time']))

  if (!chain || !symbol || !addr || !wallet || amount == null || !observed) return null

  const conviction = num(row, ['conviction', 'score', 'quality_score'])
  return {
    id: str(row, ['id', 'tx_hash', 'hash']) ?? `dune-sm-${idx}`,
    chain,
    token_symbol: symbol,
    token_address: addr,
    wallet_address: wallet,
    wallet_label: str(row, ['wallet_label', 'label', 'wallet_name']),
    amount_usd: amount,
    price_usd: num(row, ['price_usd', 'price']) ?? 0,
    conviction: conviction != null
      ? Math.max(0, Math.min(1, conviction > 1 ? conviction / 100 : conviction))
      : 0.5,
    sector: str(row, ['sector', 'category', 'narrative']),
    observed_at: observed,
  }
}

/**
 * Whale flows.
 * Required: chain, token_symbol, amount_usd, observed_at, direction OR (from/to labels).
 * Optional: token_address, amount_token, is_smart_money.
 */
export function mapWhaleRow(row: DuneRow, idx: number): WhaleFlow | null {
  const chain = asChain(str(row, ['chain', 'blockchain', 'network']))
  const symbol = str(row, ['token_symbol', 'symbol', 'token'])
  const amount = num(row, ['amount_usd', 'usd_amount', 'usd_value'])
  const observed = asIso(str(row, ['observed_at', 'block_time', 'timestamp', 'time']))

  if (!chain || !symbol || amount == null || !observed) return null

  // Direction: prefer explicit column; else infer from to_label (CEX hot wallets) heuristic.
  let directionRaw = (str(row, ['direction', 'flow_type', 'action']) ?? '').toLowerCase()
  if (!['in', 'out', 'accumulate', 'distribute'].includes(directionRaw)) {
    const to = (str(row, ['to_label', 'to']) ?? '').toLowerCase()
    directionRaw = to.includes('hot') || to.includes('exchange') || to.includes('binance') || to.includes('coinbase')
      ? 'distribute'
      : 'accumulate'
  }
  const direction = directionRaw as WhaleFlow['direction']

  const amount_token = num(row, ['amount_token', 'token_amount', 'amount'])
  const price_usd = num(row, ['price_usd', 'price'])
  const derived_token = amount_token ?? (price_usd && price_usd > 0 ? amount / price_usd : 0)

  return {
    id: str(row, ['id', 'tx_hash', 'hash']) ?? `dune-wf-${idx}`,
    chain,
    token_symbol: symbol,
    token_address: str(row, ['token_address', 'contract_address']) ?? '',
    direction,
    from_label: str(row, ['from_label', 'from', 'sender_label']),
    to_label: str(row, ['to_label', 'to', 'receiver_label']),
    amount_usd: amount,
    amount_token: derived_token,
    is_smart_money: bool(row, ['is_smart_money', 'smart_money', 'sm']) ?? false,
    observed_at: observed,
  }
}

/**
 * Exchange flows.
 * Required: exchange, chain, AND (net_flow_usd OR (inflow_usd, outflow_usd)).
 * Optional: delta_24h_pct.
 */
export function mapExchangeRow(row: DuneRow): ExchangeFlow | null {
  const exchange = str(row, ['exchange', 'cex', 'venue'])
  const chain = asChain(str(row, ['chain', 'blockchain', 'network']))
  if (!exchange || !chain) return null

  const inflow = num(row, ['inflow_usd', 'in_usd', 'usd_in']) ?? 0
  const outflow = num(row, ['outflow_usd', 'out_usd', 'usd_out']) ?? 0
  const net = num(row, ['net_flow_usd', 'net_usd', 'net'])
  const resolvedNet = net ?? (inflow - outflow)

  if (inflow === 0 && outflow === 0 && net == null) return null

  return {
    exchange,
    chain,
    inflow_usd: inflow,
    outflow_usd: outflow,
    net_flow_usd: resolvedNet,
    delta_24h_pct: num(row, ['delta_24h_pct', 'delta_pct', 'change_pct']) ?? 0,
  }
}

/**
 * Stablecoin liquidity.
 * Required: stable (USDT|USDC|DAI|FDUSD|PYUSD), chain.
 * Optional: mint_usd, burn_usd, net_inflow_usd, delta_supply_pct.
 */
const STABLES: ReadonlySet<string> = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD'])
export function mapStablecoinRow(row: DuneRow): StablecoinFlow | null {
  const stableRaw = str(row, ['stable', 'stablecoin', 'symbol'])?.toUpperCase()
  const chain = asChain(str(row, ['chain', 'blockchain', 'network']))
  if (!stableRaw || !STABLES.has(stableRaw) || !chain) return null

  const mint = num(row, ['mint_usd', 'minted_usd', 'mint']) ?? 0
  const burn = num(row, ['burn_usd', 'burned_usd', 'burn']) ?? 0
  const net = num(row, ['net_inflow_usd', 'net_usd', 'net'])
  const resolvedNet = net ?? (mint - burn)

  if (mint === 0 && burn === 0 && net == null) return null

  return {
    stable: stableRaw as StablecoinFlow['stable'],
    chain,
    mint_usd: mint,
    burn_usd: burn,
    net_inflow_usd: resolvedNet,
    delta_supply_pct: num(row, ['delta_supply_pct', 'supply_delta_pct', 'delta_pct']) ?? 0,
  }
}

/**
 * Token momentum.
 * Required: chain, token_symbol, momentum_score (0..100).
 * Optional: token_address, inflow_usd, volume_delta_pct, wallet_growth_pct, smart_money_exposure_pct.
 */
export function mapMomentumRow(row: DuneRow): TokenMomentum | null {
  const chain = asChain(str(row, ['chain', 'blockchain', 'network']))
  const symbol = str(row, ['token_symbol', 'symbol', 'token'])
  const score = num(row, ['momentum_score', 'score'])
  if (!chain || !symbol || score == null) return null

  // SM exposure: accept 0..1 ratio or 0..100 percentage.
  const sm = num(row, ['smart_money_exposure_pct', 'sm_exposure', 'smart_money_pct'])
  const smNormalized = sm == null ? 0 : sm > 1 ? sm / 100 : sm

  return {
    chain,
    token_symbol: symbol,
    token_address: str(row, ['token_address', 'contract_address']) ?? '',
    inflow_usd: num(row, ['inflow_usd', 'usd_in']) ?? 0,
    volume_delta_pct: num(row, ['volume_delta_pct', 'vol_delta_pct']) ?? 0,
    wallet_growth_pct: num(row, ['wallet_growth_pct', 'holder_growth_pct']) ?? 0,
    smart_money_exposure_pct: smNormalized,
    momentum_score: Math.max(0, Math.min(100, score)),
  }
}

// ─── Post-filters honouring the Query envelope ──────────────────────

export function filterByQuery<T extends { chain?: Chain }>(
  rows: T[],
  query: { chains?: Chain[]; limit?: number } | undefined,
): T[] {
  let out = rows
  if (query?.chains?.length) {
    const allow = new Set(query.chains)
    out = out.filter((r) => !r.chain || allow.has(r.chain))
  }
  if (query?.limit != null && query.limit > 0) out = out.slice(0, query.limit)
  return out
}
