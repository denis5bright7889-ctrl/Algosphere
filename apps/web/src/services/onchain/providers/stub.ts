/**
 * Shared scaffold for real-provider adapters that aren't wired yet.
 *
 * Each real provider (Dune, Birdeye, DexScreener, Moralis, Alchemy)
 * gets its own folder + class so wiring it later is a localised
 * change: implement the methods, done. Until then every method
 * throws ProviderNotWired with a clear message. The factory never
 * *selects* a stub unless ONCHAIN_PROVIDER explicitly names it, so
 * production stays on 'mock' and nothing breaks.
 */
import type {
  OnchainProvider, Query,
  SmartMoneyBuy, WhaleFlow, ExchangeFlow, StablecoinFlow,
  LiquidityShift, TokenMomentum, SectorRotation, HeatmapCell,
} from '../types'

export class ProviderNotWired extends Error {
  constructor(public readonly provider: string, method: string) {
    super(`Provider '${provider}' has no implementation for ${method}() yet — set ONCHAIN_PROVIDER=mock or wire this adapter.`)
    this.name = 'ProviderNotWired'
  }
}

/** Base class: every method throws until the adapter is implemented. */
export abstract class StubProvider implements OnchainProvider {
  abstract readonly name: string

  private nope(m: string): never { throw new ProviderNotWired(this.name, m) }

  async getSmartMoneyBuys(_q?: Query):    Promise<SmartMoneyBuy[]>  { return this.nope('getSmartMoneyBuys') }
  async getWhaleFlows(_q?: Query):        Promise<WhaleFlow[]>      { return this.nope('getWhaleFlows') }
  async getExchangeFlows(_q?: Query):     Promise<ExchangeFlow[]>   { return this.nope('getExchangeFlows') }
  async getStablecoinInflows(_q?: Query): Promise<StablecoinFlow[]> { return this.nope('getStablecoinInflows') }
  async getLiquidityShifts(_q?: Query):   Promise<LiquidityShift[]> { return this.nope('getLiquidityShifts') }
  async getTokenMomentum(_q?: Query):     Promise<TokenMomentum[]>  { return this.nope('getTokenMomentum') }
  async getMarketRotation(_q?: Query):    Promise<SectorRotation[]> { return this.nope('getMarketRotation') }
  async getHeatmap(_q?: Query):           Promise<HeatmapCell[]>    { return this.nope('getHeatmap') }
}
