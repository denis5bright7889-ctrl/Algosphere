/**
 * Alchemy adapter (raw transfers / token balances — good for
 * exchange-flow reconstruction and whale tracking from address
 * activity). Wire against the Alchemy API behind a server-only
 * ALCHEMY_API_KEY. Until then methods throw ProviderNotWired;
 * product surface stays on 'mock'.
 */
import { StubProvider } from '../stub'

export class AlchemyProvider extends StubProvider {
  readonly name = 'alchemy'
}
