/**
 * On-chain intelligence — provider factory.
 *
 * Resolves the active provider from ONCHAIN_PROVIDER (default
 * 'mock'). The Intelligence UI and API routes import ONLY from here
 * and ./types — never from a concrete provider. Swapping the data
 * source is a single env change + redeploy; zero UI/route rewrites.
 *
 *   ONCHAIN_PROVIDER=mock        (default — seeded, always available)
 *   ONCHAIN_PROVIDER=dune        (wire query IDs in providers/dune)
 *   ONCHAIN_PROVIDER=birdeye|dexscreener|moralis|alchemy
 *
 * Resilience: if a selected real provider throws ProviderNotWired
 * for a method, callers can opt into a mock fallback via
 * getOnchainProvider({ fallbackToMock: true }) so a half-wired
 * provider degrades gracefully instead of 500-ing a page.
 */
import type { OnchainProvider } from './types'
import { MockProvider } from './providers/mock'
import { DuneProvider } from './providers/dune'
import { BirdeyeProvider } from './providers/birdeye'
import { DexScreenerProvider } from './providers/dexscreener'
import { MoralisProvider } from './providers/moralis'
import { AlchemyProvider } from './providers/alchemy'
import { ProviderNotWired } from './providers/stub'

export * from './types'
export { ProviderNotWired }

export type ProviderName =
  | 'mock' | 'dune' | 'birdeye' | 'dexscreener' | 'moralis' | 'alchemy'

function build(name: ProviderName): OnchainProvider {
  switch (name) {
    case 'dune':        return new DuneProvider()
    case 'birdeye':     return new BirdeyeProvider()
    case 'dexscreener': return new DexScreenerProvider()
    case 'moralis':     return new MoralisProvider()
    case 'alchemy':     return new AlchemyProvider()
    case 'mock':
    default:            return new MockProvider()
  }
}

export function activeProviderName(): ProviderName {
  const raw = (process.env.ONCHAIN_PROVIDER ?? 'mock').toLowerCase()
  const known: ProviderName[] = ['mock', 'dune', 'birdeye', 'dexscreener', 'moralis', 'alchemy']
  return (known as string[]).includes(raw) ? raw as ProviderName : 'mock'
}

/**
 * Returns the active provider. With { fallbackToMock: true } the
 * returned object wraps every method so a ProviderNotWired error
 * silently degrades to the mock implementation for THAT method —
 * letting the product surface ship before every adapter is complete.
 */
export function getOnchainProvider(
  opts: { fallbackToMock?: boolean } = {},
): OnchainProvider {
  const name = activeProviderName()
  const primary = build(name)
  if (name === 'mock' || !opts.fallbackToMock) return primary

  const mock = new MockProvider()
  const wrap = <A extends unknown[], R>(
    primaryFn: (...a: A) => Promise<R>,
    mockFn:    (...a: A) => Promise<R>,
  ) => async (...a: A): Promise<R> => {
    try {
      return await primaryFn.apply(primary, a)
    } catch (e) {
      if (e instanceof ProviderNotWired) return mockFn.apply(mock, a)
      throw e
    }
  }

  return {
    name: `${name}+mockfallback`,
    getSmartMoneyBuys:    wrap(primary.getSmartMoneyBuys,    mock.getSmartMoneyBuys),
    getWhaleFlows:        wrap(primary.getWhaleFlows,        mock.getWhaleFlows),
    getExchangeFlows:     wrap(primary.getExchangeFlows,     mock.getExchangeFlows),
    getStablecoinInflows: wrap(primary.getStablecoinInflows, mock.getStablecoinInflows),
    getLiquidityShifts:   wrap(primary.getLiquidityShifts,   mock.getLiquidityShifts),
    getTokenMomentum:     wrap(primary.getTokenMomentum,     mock.getTokenMomentum),
    getMarketRotation:    wrap(primary.getMarketRotation,    mock.getMarketRotation),
    getHeatmap:           wrap(primary.getHeatmap,           mock.getHeatmap),
    getNarrative:         primary.getNarrative?.bind(primary) ?? mock.getNarrative?.bind(mock),
  }
}
