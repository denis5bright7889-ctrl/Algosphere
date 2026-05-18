/**
 * DexScreener adapter (free public DEX pair data — good for token
 * momentum / liquidity shifts). Wire against the public DexScreener
 * endpoints (no key required). Until then methods throw
 * ProviderNotWired; product surface stays on 'mock'.
 */
import { StubProvider } from '../stub'

export class DexScreenerProvider extends StubProvider {
  readonly name = 'dexscreener'
}
