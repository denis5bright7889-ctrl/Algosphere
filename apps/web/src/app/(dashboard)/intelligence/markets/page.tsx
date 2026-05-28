/**
 * Markets Explorer — institutional symbol catalog (Phase 4).
 *
 * Server shell: reads the static symbol registry + the latest engine
 * regime snapshots, then hands both to a client table for fast
 * filter/sort/search without re-fetching. The regime overlay is real —
 * unscanned rows render as "—", never imagined.
 */
import { loadIntelContext } from '../_components/guard'
import { createClient } from '@/lib/supabase/server'
import { symbolRegistry } from '@/lib/symbol-registry'
import MarketsExplorer, { type RegimeRow } from './MarketsExplorer'

export const metadata = { title: 'Markets Explorer — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function MarketsExplorerPage() {
  await loadIntelContext()
  const registry = symbolRegistry()

  // Latest regime per symbol — RLS-scoped read.
  const supabase = await createClient()
  const { data: snaps } = await supabase
    .from('regime_snapshots')
    .select('symbol, regime, der_score, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(200)

  const regimes: Record<string, RegimeRow> = {}
  for (const r of snaps ?? []) {
    if (regimes[r.symbol]) continue
    regimes[r.symbol] = { regime: r.regime, der_score: r.der_score, scanned_at: r.scanned_at }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Markets <span className="text-gradient">Explorer</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The institutional symbol catalog — {registry.length} instruments across crypto,
          forex, metals, indices, equities, commodities. Filter by liquidity, volatility,
          asset class, or sector; engine regime + confidence overlay where the scanner has
          covered the symbol.
        </p>
      </header>

      <MarketsExplorer registry={registry} regimes={regimes} />
    </main>
  )
}
