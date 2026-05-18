/**
 * Birdeye adapter (token momentum / liquidity — strong on Solana).
 * Wire by implementing the OnchainProvider methods against the
 * Birdeye REST API behind a server-only BIRDEYE_API_KEY. Until then
 * methods throw ProviderNotWired; product surface stays on 'mock'.
 */
import { StubProvider } from '../stub'

export class BirdeyeProvider extends StubProvider {
  readonly name = 'birdeye'
}
