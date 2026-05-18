/**
 * Moralis adapter (wallet / token transfers — good for whale flows
 * and exchange flows via labelled wallets). Wire against the Moralis
 * Web3 Data API behind a server-only MORALIS_API_KEY. Until then
 * methods throw ProviderNotWired; product surface stays on 'mock'.
 */
import { StubProvider } from '../stub'

export class MoralisProvider extends StubProvider {
  readonly name = 'moralis'
}
