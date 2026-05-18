/**
 * Mock on-chain provider. Implements the full OnchainProvider
 * contract with deterministic seeded data so the entire Intelligence
 * product surface is buildable and demoable today, with zero
 * external dependency. Swapped for a real provider by setting
 * ONCHAIN_PROVIDER (see ../../index.ts) — no UI change.
 */
import type {
  OnchainProvider, Query, ProviderNarrative,
} from '../../types'
import * as seed from './seed'

const SEED = 20260518

const NARRATIVES: Record<ProviderNarrative['surface'], string> = {
  'smart-money':
    'Smart money is concentrating into AI and RWA names while trimming majors. Conviction on new positions is above the 30-day average.',
  'whale-flows':
    'Net whale behaviour is accumulation-skewed this window, with the largest single transfers moving off exchanges into cold storage.',
  'exchange-flows':
    'Exchange balances are net-declining — historically a supply-tightening signal. Coinbase shows the largest outflow.',
  'stablecoin-liquidity':
    'Stablecoin supply is expanding, led by USDT on Tron and USDC on Base — fresh dry powder entering the system.',
  'token-momentum':
    'Momentum is broadening beyond memes into infrastructure; wallet-growth is leading volume, a healthier internal.',
  'market-rotation':
    'Capital is rotating out of Meme into AI and RWA. L2 strength is fading as incentives roll off.',
  'heatmap':
    'Solana and Base dominate activity intensity; Ethereum still leads raw liquidity. Smart-money concentration highest on Base.',
}

export class MockProvider implements OnchainProvider {
  readonly name = 'mock'

  async getSmartMoneyBuys(q?: Query)    { return seed.smartMoney(SEED, q?.limit ?? 40) }
  async getWhaleFlows(q?: Query)        { return seed.whaleFlows(SEED + 1, q?.limit ?? 40) }
  async getExchangeFlows()              { return seed.exchangeFlows(SEED + 2) }
  async getStablecoinInflows()          { return seed.stablecoins(SEED + 3) }
  async getLiquidityShifts()            { return seed.liquidityShifts(SEED + 4) }
  async getTokenMomentum(q?: Query)     { return seed.tokenMomentum(SEED + 5, q?.limit ?? 30) }
  async getMarketRotation()             { return seed.marketRotation(SEED + 6) }
  async getHeatmap()                    { return seed.heatmap(SEED + 7) }

  async getNarrative(surface: ProviderNarrative['surface']): Promise<ProviderNarrative> {
    return {
      surface,
      body:         NARRATIVES[surface],
      generated_at: new Date().toISOString(),
    }
  }
}
