/**
 * Correlations — dedicated cross-asset correlation surface.
 *
 * Wraps the existing CorrelationsPanel (30d Pearson over the pairs we can
 * source historically — BTC/ETH/SOL/Gold). Honest about scope: equity
 * indices / DXY / VIX correlations aren't here because no free historical
 * feed serves them, and showing permanent nulls would mislead.
 */
import Link from 'next/link'
import { loadIntelContext } from '../_components/guard'
import CorrelationsPanel from '@/components/market/CorrelationsPanel'

export const metadata = { title: 'Correlations — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function CorrelationsPage() {
  await loadIntelContext()

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cross-Asset <span className="text-gradient">Correlations</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rolling 30-day Pearson correlation of daily returns. Strong positive
          and inverse pairs flag diversification and hedging behaviour.
        </p>
      </header>

      <CorrelationsPanel />

      <section className="rounded-xl border border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Scope &amp; honesty</h2>
        <ul className="space-y-1.5">
          <li>• Computed over the pairs the AlgoSphere data engine serves historical closes for. Some asset classes are intentionally excluded when reliable historicals aren&apos;t available.</li>
          <li>• Equity-index / DXY / VIX correlations are intentionally omitted to avoid misleading permanent nulls.</li>
          <li>• We do <span className="font-semibold text-foreground/80">not</span> infer institutional positioning, dark-pool flow, or options exposure from correlation.</li>
        </ul>
        <p className="mt-3">
          For per-symbol context, open any instrument&apos;s chart and check the Correlation card in the AI rail, or explore the{' '}
          <Link href="/intelligence/sectors" className="text-amber-300 hover:underline">sector intelligence</Link> view.
        </p>
      </section>
    </main>
  )
}
