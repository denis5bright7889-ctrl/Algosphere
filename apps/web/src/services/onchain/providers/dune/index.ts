/**
 * Dune adapter. Wiring guide:
 *
 *   1. Author queries on dune.com, note each numeric query_id.
 *   2. Map them here, e.g.:
 *        const Q = { smartMoney: 1234567, whaleFlows: 1234568, ... }
 *   3. Use the existing `@/lib/dune` client:
 *        import { getLatestResults } from '@/lib/dune'
 *        const { rows } = await getLatestResults<Row>(Q.smartMoney, params)
 *      then map `rows` → SmartMoneyBuy[].
 *
 * Until step 1-3 are done every method throws ProviderNotWired and
 * the factory keeps production on 'mock'. The product surface does
 * NOT wait on this.
 */
import { StubProvider } from '../stub'

export class DuneProvider extends StubProvider {
  readonly name = 'dune'
}
