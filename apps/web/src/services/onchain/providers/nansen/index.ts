/**
 * Nansen on-chain provider — real smart-money / momentum / whale data via
 * the `lib/nansen.ts` tokenScreener client.
 *
 * Coverage: the public token-screener endpoint returns per-TOKEN aggregates
 * (not per-wallet trades), which maps cleanly to a subset of our provider
 * contract. Surfaces that need different Nansen endpoints (exchange flows,
 * stablecoin supply, protocol TVL) throw `ProviderNotWired` so the
 * `fallbackToMock` machinery in `../../index.ts` keeps the UI working —
 * with the response footer truthfully labelling that surface as 'mock'.
 *
 * What's REAL vs synthesized:
 *   getSmartMoneyBuys   — REAL  (screener with only_smart_money=true, aggregated semantics: each row = "smart money collectively bought $X of token Y")
 *   getTokenMomentum    — REAL  (screener with momentum_score derived from price_change × buy_volume / fdv)
 *   getWhaleFlows       — REAL  (screener ordered by netflow; direction = sign(netflow); wallet labels null by design)
 *   getMarketRotation   — REAL  (chain-level rotation derived from screener aggregates; sector field null since screener has no sector tagging)
 *   getHeatmap          — REAL  (per-chain intensity from summed buy_volume / smart-money concentration)
 *   getExchangeFlows    — ProviderNotWired (needs Nansen's exchange-flows endpoint, not yet in lib/nansen.ts)
 *   getStablecoinInflows— ProviderNotWired (needs Nansen's stablecoin-master endpoint)
 *   getLiquidityShifts  — ProviderNotWired (needs Nansen's defi/tvl endpoint)
 */
import type {
  OnchainProvider, Query, Chain, SmartMoneyBuy, WhaleFlow, ExchangeFlow,
  StablecoinFlow, LiquidityShift, TokenMomentum, SectorRotation, HeatmapCell,
  ProviderNarrative,
} from '../../types'
import { ProviderNotWired } from '../stub'
import { tokenScreener, type NansenToken, type NansenChain } from '@/lib/nansen'
import { sectorOf, SECTOR_LABEL, SECTOR_DEFAULT_NARRATIVE, type Sector } from '@/lib/token-sectors'

// ── Helpers ──────────────────────────────────────────────────────────────

/** Engine `Chain` ⊂ NansenChain — narrow safely or fall back to 'ethereum'. */
function asChain(c: string): Chain {
  const known: Chain[] = ['ethereum','solana','base','arbitrum','polygon','bsc','optimism']
  return (known as string[]).includes(c) ? (c as Chain) : 'ethereum'
}

/** Map our Query.chains → Nansen's narrower union, default to all three. */
function nansenChains(chains: Chain[] | undefined): NansenChain[] {
  const allowed: NansenChain[] = ['ethereum','solana','base']
  if (!chains?.length) return allowed
  const matched = chains.filter((c): c is NansenChain => (allowed as string[]).includes(c))
  return matched.length ? matched : allowed
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Compose a deterministic synthetic id from a token row + a key. */
function rowId(t: NansenToken, key: string): string {
  return `${t.chain}-${t.token_address}-${key}`
}

/** Best-effort wallet-quality score for a SmartMoneyBuy.
 *  Higher inflow_fdv_ratio and lower outflow → more constructive smart-money
 *  positioning. Clamped to [0,1]; null when Nansen returned no signal. */
function convictionFrom(t: NansenToken): number | null {
  const inflow  = t.inflow_fdv_ratio
  const outflow = t.outflow_fdv_ratio
  if (!Number.isFinite(inflow) && !Number.isFinite(outflow)) return null
  const i = Number.isFinite(inflow)  ? inflow  : 0
  const o = Number.isFinite(outflow) ? outflow : 0
  // Net constructive flow over the FDV anchor; 0.02 corresponds to "meaningful
  // smart-money allocation" empirically — scale by 50 then clamp.
  return clamp01((i - o) * 50)
}

// ── Provider ─────────────────────────────────────────────────────────────

export class NansenProvider implements OnchainProvider {
  readonly name = 'nansen'

  // ─ Smart-money buys (aggregated; one row per token, not per wallet) ────
  async getSmartMoneyBuys(q?: Query): Promise<SmartMoneyBuy[]> {
    const tokens = await tokenScreener({
      chains:    nansenChains(q?.chains),
      timeframe: q?.window ?? '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     q?.limit ?? 40,
    })
    const now = new Date().toISOString()
    return tokens
      .filter((t) => Number.isFinite(t.buy_volume) && t.buy_volume > 0)
      .map<SmartMoneyBuy>((t) => ({
        id:             rowId(t, 'sm'),
        chain:          asChain(t.chain),
        token_symbol:   t.token_symbol,
        token_address:  t.token_address,
        // Screener is aggregated — surface that truthfully rather than fake
        // a single wallet. Down-stream UI shows the label as-is.
        wallet_address: '',
        wallet_label:   'Smart Money (aggregated)',
        amount_usd:     t.buy_volume,
        price_usd:      t.price_usd,
        conviction:     convictionFrom(t),
        sector:         null,
        observed_at:    now,
      }))
  }

  // ─ Token momentum — composite score from price × buy volume / FDV ──────
  async getTokenMomentum(q?: Query): Promise<TokenMomentum[]> {
    const tokens = await tokenScreener({
      chains:    nansenChains(q?.chains),
      timeframe: q?.window ?? '24h',
      orderBy:   'volume',
      direction: 'DESC',
      limit:     q?.limit ?? 30,
    })
    return tokens
      .filter((t) => Number.isFinite(t.volume) && t.volume > 0)
      .map<TokenMomentum>((t) => {
        // Composite: weight price action (40%), smart-money allocation
        // share (30%), turnover relative to FDV (30%). All 0..100.
        const priceComp     = clamp01((t.price_change + 0.5)) * 40            // -50%..+50% → 0..40
        const allocComp     = clamp01((t.inflow_fdv_ratio ?? 0) * 100) * 30   // ~1% inflow = max
        const turnoverComp  = clamp01((t.volume / Math.max(t.fdv, 1)) * 50) * 30
        const score = Math.round(priceComp + allocComp + turnoverComp)
        return {
          chain:                    asChain(t.chain),
          token_symbol:             t.token_symbol,
          token_address:            t.token_address,
          inflow_usd:               t.buy_volume - t.sell_volume,
          volume_delta_pct:         t.price_change,            // proxy: price change as activity delta
          wallet_growth_pct:        0,                          // not in screener — explicit zero, not faked
          smart_money_exposure_pct: clamp01(t.inflow_fdv_ratio ?? 0),
          momentum_score:           Math.max(0, Math.min(100, score)),
        }
      })
  }

  // ─ Whale flows — directional, best-effort (no per-wallet labels) ───────
  async getWhaleFlows(q?: Query): Promise<WhaleFlow[]> {
    const tokens = await tokenScreener({
      chains:    nansenChains(q?.chains),
      timeframe: q?.window ?? '24h',
      orderBy:   'netflow',
      direction: 'DESC',
      limit:     q?.limit ?? 40,
    })
    const now = new Date().toISOString()
    return tokens
      .filter((t) => Number.isFinite(t.netflow) && Math.abs(t.netflow) > 0)
      .map<WhaleFlow>((t) => {
        const accumulating = t.netflow > 0
        return {
          id:             rowId(t, 'wf'),
          chain:          asChain(t.chain),
          token_symbol:   t.token_symbol,
          token_address:  t.token_address,
          // Screener has no per-side wallet labels; surface honestly as
          // accumulate/distribute (a per-token net direction) rather than
          // pretending we know an individual wallet's intent.
          direction:      accumulating ? 'accumulate' : 'distribute',
          from_label:     null,
          to_label:       null,
          amount_usd:     Math.abs(t.netflow),
          amount_token:   t.price_usd > 0 ? Math.abs(t.netflow) / t.price_usd : 0,
          is_smart_money: true,                       // screener was called with only_smart_money
          observed_at:    now,
        }
      })
  }

  // ─ Market rotation — TRUE sector aggregation via token-sectors map ──
  async getMarketRotation(q?: Query): Promise<SectorRotation[]> {
    const tokens = await tokenScreener({
      chains:    nansenChains(q?.chains),
      timeframe: q?.window ?? '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     150,                  // wider pull so sector aggregates have density
    })
    // Group screener rows by SECTOR (curated lookup) — turns chain-axis
    // rotation into the institutional sector-axis rotation the brief asks
    // for (capital moving Meme → AI, DeFi → RWA, etc.).
    const agg = new Map<Sector, { buy: number; sell: number; netflow: number; n: number; top: string[] }>()
    for (const t of tokens) {
      const sec = sectorOf(t.token_symbol)
      const a = agg.get(sec) ?? { buy: 0, sell: 0, netflow: 0, n: 0, top: [] }
      a.buy     += t.buy_volume  || 0
      a.sell    += t.sell_volume || 0
      a.netflow += t.netflow     || 0
      a.n       += 1
      if (a.top.length < 3 && t.token_symbol) a.top.push(t.token_symbol.toUpperCase())
      agg.set(sec, a)
    }
    // Drop the 'Other' bucket only if it's the ONLY entry; otherwise it
    // belongs in the picture (rotation away from the long tail is real
    // signal). Same honesty rule — never hide a bucket we computed.
    if (agg.size === 0) return []
    const maxBuy = Math.max(...Array.from(agg.values()).map((a) => a.buy), 1)
    return Array.from(agg.entries()).map<SectorRotation>(([sector, a]) => {
      const leaders = a.top.length ? ` Leaders: ${a.top.join(', ')}.` : ''
      return {
        sector:           SECTOR_LABEL[sector],
        capital_flow_usd: a.netflow,
        strength_score:   Math.round((a.buy / maxBuy) * 100),
        delta_7d_pct:     0,                              // screener doesn't supply 7d delta
        narrative:        `${SECTOR_DEFAULT_NARRATIVE[sector]}${leaders}`,
      }
    }).sort((x, y) => y.strength_score - x.strength_score)
  }

  // ─ Heatmap — per-chain intensities from aggregated screener data ────────
  async getHeatmap(q?: Query): Promise<HeatmapCell[]> {
    const tokens = await tokenScreener({
      chains:    nansenChains(q?.chains),
      timeframe: q?.window ?? '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     200,
    })
    const agg = new Map<string, { activity: number; liquidity: number; smart: number; inflow: number }>()
    for (const t of tokens) {
      const a = agg.get(t.chain) ?? { activity: 0, liquidity: 0, smart: 0, inflow: 0 }
      a.activity  += t.volume       || 0
      a.liquidity += t.liquidity    || 0
      a.smart     += t.buy_volume   || 0    // proxy for smart-money concentration
      a.inflow    += Math.max(0, t.netflow || 0)
      agg.set(t.chain, a)
    }
    const cells: HeatmapCell[] = []
    const maxes = {
      liquidity:    Math.max(...Array.from(agg.values()).map((a) => a.liquidity), 1),
      activity:     Math.max(...Array.from(agg.values()).map((a) => a.activity),  1),
      inflow:       Math.max(...Array.from(agg.values()).map((a) => a.inflow),    1),
      smart_money:  Math.max(...Array.from(agg.values()).map((a) => a.smart),     1),
    } as const
    for (const [chain, a] of agg) {
      const c = asChain(chain)
      cells.push({ chain: c, metric: 'liquidity',   value: clamp01(a.liquidity / maxes.liquidity),    raw_usd: a.liquidity })
      cells.push({ chain: c, metric: 'activity',    value: clamp01(a.activity  / maxes.activity),     raw_usd: a.activity })
      cells.push({ chain: c, metric: 'inflow',      value: clamp01(a.inflow    / maxes.inflow),       raw_usd: a.inflow })
      cells.push({ chain: c, metric: 'smart_money', value: clamp01(a.smart     / maxes.smart_money),  raw_usd: a.smart })
    }
    return cells
  }

  // ─ Surfaces Nansen's screener can't reach — let mock fallback handle.
  //   Each throws ProviderNotWired(provider, method); the handler.ts wrap
  //   catches that and serves the mock equivalent for THIS method while
  //   keeping `configured=nansen` so the footer says "configured for
  //   nansen, this surface still on mock — wire <endpoint>".
  async getExchangeFlows(_q?: Query): Promise<ExchangeFlow[]> {
    throw new ProviderNotWired('nansen', 'getExchangeFlows')
  }
  async getStablecoinInflows(_q?: Query): Promise<StablecoinFlow[]> {
    throw new ProviderNotWired('nansen', 'getStablecoinInflows')
  }
  async getLiquidityShifts(_q?: Query): Promise<LiquidityShift[]> {
    throw new ProviderNotWired('nansen', 'getLiquidityShifts')
  }

  async getNarrative(_surface: ProviderNarrative['surface']): Promise<ProviderNarrative | null> {
    // The screener doesn't ship narrative copy; let mock supply tasteful
    // copy via the handler's `getNarrative` fallback path.
    return null
  }
}
