/**
 * Dune Analytics adapter — production-grade, NO FABRICATION.
 *
 * Each surface is wired to a specific Dune query whose ID is supplied
 * via env (DUNE_QUERY_WHALES, DUNE_QUERY_STABLECOINS, etc.). For any
 * surface whose query is *not* configured the method throws
 * `ProviderNotWired`, which the factory in `services/onchain/index.ts`
 * catches and falls back to the mock provider — per method, not per
 * provider — so partial wiring is safe.
 *
 * Caching: `lib/dune.ts` passes `next: { revalidate: 60 }` on every
 * `getLatestResults` call, so identical requests are de-duped by the
 * Next.js fetch cache for 60s without any external Redis. That is
 * cheaper than Redis for this workload because Dune's `/results`
 * endpoint itself returns the query's cached output (no credit charge).
 *
 * Required query column contracts live in `./README.md`. The
 * normalisers in `./normalize.ts` accept the common variants so the
 * Dune author isn't locked into one schema.
 */
import type {
  OnchainProvider, Query,
  SmartMoneyBuy, WhaleFlow, ExchangeFlow, StablecoinFlow,
  TokenMomentum, ProviderNarrative,
} from '../../types'
import { getLatestResults, isDuneConfigured, DuneError } from '@/lib/dune'
import { ProviderNotWired } from '../stub'
import {
  mapSmartMoneyRow, mapWhaleRow, mapExchangeRow, mapStablecoinRow, mapMomentumRow,
  filterByQuery,
} from './normalize'

/** Env-var → surface mapping for the brief's five wired surfaces. */
const ENV_VAR = {
  smartMoney:    'DUNE_QUERY_SMART_MONEY',
  whaleFlows:    'DUNE_QUERY_WHALES',
  exchangeFlows: 'DUNE_QUERY_EXCHANGE_FLOWS',
  stablecoins:   'DUNE_QUERY_STABLECOINS',
  tokenMomentum: 'DUNE_QUERY_TOKEN_MOMENTUM',
} as const
type Surface = keyof typeof ENV_VAR

function queryIdFor(surface: Surface): number {
  if (!isDuneConfigured()) throw new ProviderNotWired('dune', `${surface} (DUNE_API_KEY missing)`)
  const envKey = ENV_VAR[surface]
  const raw = process.env[envKey]
  if (!raw) throw new ProviderNotWired('dune', `${surface} (${envKey} missing)`)
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new ProviderNotWired('dune', `${surface} (${envKey}=${raw} is not a positive integer)`)
  }
  return id
}

function paramsFromQuery(q?: Query): Record<string, string | number> | undefined {
  if (!q) return undefined
  const p: Record<string, string | number> = {}
  if (q.window) p.window = q.window
  if (q.chains?.length) p.chains = q.chains.join(',')
  // Dune doesn't penalise unknown params — the query author opts in by
  // declaring `{{window}}` / `{{chains}}` in their SQL.
  return Object.keys(p).length ? p : undefined
}

async function fetchRows(surface: Surface, q?: Query) {
  const id = queryIdFor(surface)
  // 500-row ceiling is generous for any UI surface and keeps payloads
  // bounded if a query author forgets to LIMIT their SQL.
  const result = await getLatestResults(id, paramsFromQuery(q), { limit: 500 })
  return result.rows
}

/**
 * If a DuneError reports the key is missing, escalate to
 * `ProviderNotWired` so the factory falls back to mock for that
 * method. Hard errors (HTTP 5xx, timeout) propagate so the route can
 * surface them honestly.
 */
function rethrow(e: unknown, surface: string): never {
  if (e instanceof ProviderNotWired) throw e
  if (e instanceof DuneError && e.code === 'no_key') {
    throw new ProviderNotWired('dune', `${surface} (DUNE_API_KEY missing)`)
  }
  throw e
}

export class DuneProvider implements OnchainProvider {
  readonly name = 'dune'

  async getSmartMoneyBuys(q?: Query): Promise<SmartMoneyBuy[]> {
    try {
      const rows = await fetchRows('smartMoney', q)
      const mapped = rows
        .map((r, i) => mapSmartMoneyRow(r, i))
        .filter((x): x is SmartMoneyBuy => x !== null)
      return filterByQuery(mapped, q)
    } catch (e) { rethrow(e, 'getSmartMoneyBuys') }
  }

  async getWhaleFlows(q?: Query): Promise<WhaleFlow[]> {
    try {
      const rows = await fetchRows('whaleFlows', q)
      const mapped = rows
        .map((r, i) => mapWhaleRow(r, i))
        .filter((x): x is WhaleFlow => x !== null)
      return filterByQuery(mapped, q)
    } catch (e) { rethrow(e, 'getWhaleFlows') }
  }

  async getExchangeFlows(q?: Query): Promise<ExchangeFlow[]> {
    try {
      const rows = await fetchRows('exchangeFlows', q)
      const mapped = rows
        .map((r) => mapExchangeRow(r))
        .filter((x): x is ExchangeFlow => x !== null)
      return filterByQuery(mapped, q)
    } catch (e) { rethrow(e, 'getExchangeFlows') }
  }

  async getStablecoinInflows(q?: Query): Promise<StablecoinFlow[]> {
    try {
      const rows = await fetchRows('stablecoins', q)
      const mapped = rows
        .map((r) => mapStablecoinRow(r))
        .filter((x): x is StablecoinFlow => x !== null)
      return filterByQuery(mapped, q)
    } catch (e) { rethrow(e, 'getStablecoinInflows') }
  }

  async getTokenMomentum(q?: Query): Promise<TokenMomentum[]> {
    try {
      const rows = await fetchRows('tokenMomentum', q)
      const mapped = rows
        .map((r) => mapMomentumRow(r))
        .filter((x): x is TokenMomentum => x !== null)
      return filterByQuery(mapped, q)
    } catch (e) { rethrow(e, 'getTokenMomentum') }
  }

  // The brief named 5 surfaces — these three remain unwired until the
  // user supplies queries. ProviderNotWired triggers per-method mock
  // fallback in the factory, so the UI doesn't break.
  async getLiquidityShifts(_q?: Query): Promise<never> {
    throw new ProviderNotWired('dune', 'getLiquidityShifts (no DUNE_QUERY_LIQUIDITY_SHIFTS configured)')
  }
  async getMarketRotation(_q?: Query): Promise<never> {
    throw new ProviderNotWired('dune', 'getMarketRotation (no DUNE_QUERY_MARKET_ROTATION configured)')
  }
  async getHeatmap(_q?: Query): Promise<never> {
    throw new ProviderNotWired('dune', 'getHeatmap (no DUNE_QUERY_HEATMAP configured)')
  }

  /**
   * Deterministic factual narrative — strictly derived from the actual
   * rows we just fetched. NO LLM, NO subjective claims about what the
   * data means for price. Two-sentence aggregate observation: a totals
   * line and a top-contributor line.
   */
  async getNarrative(
    surface: ProviderNarrative['surface'],
    q?: Query,
  ): Promise<ProviderNarrative | null> {
    try {
      const body = await this.buildNarrative(surface, q)
      if (!body) return null
      return { surface, body, generated_at: new Date().toISOString() }
    } catch {
      // Narrative is best-effort — if the underlying surface fails we
      // return null and the UI hides the card. Never fabricate.
      return null
    }
  }

  private async buildNarrative(
    surface: ProviderNarrative['surface'],
    q?: Query,
  ): Promise<string | null> {
    if (surface === 'smart-money') {
      const rows = await this.getSmartMoneyBuys({ ...q, limit: 50 })
      if (!rows.length) return null
      const total = rows.reduce((s, r) => s + r.amount_usd, 0)
      const bySector = new Map<string, number>()
      for (const r of rows) bySector.set(r.sector ?? 'Other', (bySector.get(r.sector ?? 'Other') ?? 0) + r.amount_usd)
      const top = [...bySector.entries()].sort((a, b) => b[1] - a[1])[0]
      return `${rows.length} smart-money buys totalling ${usd(total)} across ${bySector.size} sectors${top ? `. Leading sector: ${top[0]} (${usd(top[1])}).` : '.'}`
    }
    if (surface === 'whale-flows') {
      const rows = await this.getWhaleFlows({ ...q, limit: 100 })
      if (!rows.length) return null
      let accum = 0, distr = 0
      for (const r of rows) {
        if (r.direction === 'in' || r.direction === 'accumulate') accum += r.amount_usd
        else distr += r.amount_usd
      }
      const net = accum - distr
      return `Whale accumulation ${usd(accum)} vs distribution ${usd(distr)} over the window. Net: ${net >= 0 ? '+' : ''}${usd(net)}.`
    }
    if (surface === 'exchange-flows') {
      const rows = await this.getExchangeFlows({ ...q, limit: 50 })
      if (!rows.length) return null
      const sortedNet = [...rows].sort((a, b) => a.net_flow_usd - b.net_flow_usd)
      const biggestOut = sortedNet[0]!
      const biggestIn  = sortedNet[sortedNet.length - 1]!
      const totalNet = rows.reduce((s, r) => s + r.net_flow_usd, 0)
      return `Aggregate exchange net flow: ${usd(totalNet)}. Largest outflow: ${biggestOut.exchange} (${usd(biggestOut.net_flow_usd)}); largest inflow: ${biggestIn.exchange} (${usd(biggestIn.net_flow_usd)}).`
    }
    if (surface === 'stablecoin-liquidity') {
      const rows = await this.getStablecoinInflows({ ...q, limit: 100 })
      if (!rows.length) return null
      const total = rows.reduce((s, r) => s + r.net_inflow_usd, 0)
      const byStable = new Map<string, number>()
      for (const r of rows) byStable.set(r.stable, (byStable.get(r.stable) ?? 0) + r.net_inflow_usd)
      const top = [...byStable.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]
      return `Net stablecoin liquidity: ${total >= 0 ? '+' : ''}${usd(total)}${top ? `. Largest mover: ${top[0]} (${top[1] >= 0 ? '+' : ''}${usd(top[1])}).` : '.'}`
    }
    if (surface === 'token-momentum') {
      const rows = await this.getTokenMomentum({ ...q, limit: 100 })
      if (!rows.length) return null
      const top3 = [...rows].sort((a, b) => b.momentum_score - a.momentum_score).slice(0, 3)
      const list = top3.map((t) => `${t.token_symbol} (${t.momentum_score})`).join(', ')
      return `Top momentum: ${list}. ${rows.length} tokens scored.`
    }
    return null
  }
}

function usd(n: number): string {
  if (!Number.isFinite(n)) return '$—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(0)}`
}
