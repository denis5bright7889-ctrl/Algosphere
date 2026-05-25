/**
 * On-chain intelligence — provider factory.
 *
 * Resolves the active provider from ONCHAIN_PROVIDER (default
 * 'mock'). The Intelligence UI and API routes import ONLY from here
 * and ./types — never from a concrete provider. Swapping the data
 * source is a single env change + redeploy; zero UI/route rewrites.
 *
 *   ONCHAIN_PROVIDER=mock        (default — seeded, always available)
 *   ONCHAIN_PROVIDER=nansen      (real smart-money / momentum / heatmap;
 *                                 surfaces the screener can't reach throw
 *                                 ProviderNotWired and fall back to mock)
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
import { NansenProvider } from './providers/nansen'
import { DuneProvider } from './providers/dune'
import { BirdeyeProvider } from './providers/birdeye'
import { DexScreenerProvider } from './providers/dexscreener'
import { MoralisProvider } from './providers/moralis'
import { AlchemyProvider } from './providers/alchemy'
import { ProviderNotWired } from './providers/stub'

export * from './types'
export { ProviderNotWired }

export type ProviderName =
  | 'mock' | 'nansen' | 'dune' | 'birdeye' | 'dexscreener' | 'moralis' | 'alchemy'

function build(name: ProviderName): OnchainProvider {
  switch (name) {
    case 'nansen':      return new NansenProvider()
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
  const known: ProviderName[] = ['mock', 'nansen', 'dune', 'birdeye', 'dexscreener', 'moralis', 'alchemy']
  return (known as string[]).includes(raw) ? raw as ProviderName : 'mock'
}

/**
 * A provider plus a truthful read of which source actually served
 * the most recent call. `lastSource()` is per-instance and a fresh
 * instance is created per `getOnchainProvider()` call (one per
 * request), so it's concurrency-safe.
 */
export interface TrackedProvider extends OnchainProvider {
  /**
   * The source that answered the LAST get* call:
   *   - the configured provider name when it served the data, OR
   *   - 'mock' when that surface wasn't wired and silently fell back.
   * The route reports THIS — never the configured name blindly — so
   * a half-wired Dune deployment can't label mock rows as real.
   */
  lastSource(): ProviderName
}

/**
 * Returns the active provider. With { fallbackToMock: true } a
 * ProviderNotWired from the configured provider degrades to mock for
 * THAT method — letting the product ship before every adapter is
 * complete. Critically, the fallback is RECORDED: `lastSource()`
 * tells the caller whether real-provider or mock data was returned,
 * so the transparency footer never lies.
 */
export function getOnchainProvider(
  opts: { fallbackToMock?: boolean } = {},
): TrackedProvider {
  const name = activeProviderName()
  const primary = build(name)
  let effective: ProviderName = name

  // Mock provider, or fallback disabled → no ambiguity: every call is
  // the configured provider. Still expose lastSource() uniformly.
  if (name === 'mock' || !opts.fallbackToMock) {
    return Object.assign(Object.create(Object.getPrototypeOf(primary)), primary, {
      lastSource: () => name,
    }) as TrackedProvider
  }

  const mock = new MockProvider()
  const wrap = <A extends unknown[], R>(
    primaryFn: (...a: A) => Promise<R>,
    mockFn:    (...a: A) => Promise<R>,
  ) => async (...a: A): Promise<R> => {
    try {
      const r = await primaryFn.apply(primary, a)
      effective = name
      return r
    } catch (e) {
      if (e instanceof ProviderNotWired) {
        effective = 'mock'
        return mockFn.apply(mock, a)
      }
      throw e
    }
  }

  return {
    name: `${name}+mockfallback`,
    lastSource: () => effective,
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
