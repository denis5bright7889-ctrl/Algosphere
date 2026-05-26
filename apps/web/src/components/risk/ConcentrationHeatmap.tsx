/**
 * ConcentrationHeatmap — portfolio concentration as a heat grid (Phase 7).
 *
 * Honest about its data: this is a CONCENTRATION heatmap built from the
 * reconciler's real `by_symbol` notional breakdown, not a price-correlation
 * matrix (true correlation needs a per-symbol price-history feed this table
 * doesn't carry — see the note rendered in the footer). Each cell is a
 * symbol; heat intensity = its share of total notional, bucketed into five
 * bands so we use static Tailwind classes (no runtime inline styles). Cells
 * breaching the per-symbol concentration cap get a red ring.
 *
 * Pure/presentational — server-renderable, no client JS.
 */
export interface SymbolExposure {
  sym: string
  notional: number
  pct: number
}

const usd = (v: number) =>
  v >= 1000
    ? `$${(v / 1000).toFixed(1)}k`
    : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

/** Bucket a 0..1 heat ratio into a static class triplet (cool → hot). */
function heatClass(ratio: number): string {
  if (ratio >= 0.8) return 'bg-red-500/30 border-red-500/50 text-red-100'
  if (ratio >= 0.6) return 'bg-orange-500/25 border-orange-500/40 text-orange-100'
  if (ratio >= 0.4) return 'bg-amber-500/20 border-amber-500/40 text-amber-100'
  if (ratio >= 0.2) return 'bg-blue-500/15 border-blue-500/30 text-blue-100'
  return 'bg-muted/40 border-border text-muted-foreground'
}

export default function ConcentrationHeatmap({
  symbols, capPct,
}: { symbols: SymbolExposure[]; capPct: number | null }) {
  if (symbols.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-base font-medium">Concentration heatmap</h2>
        <p className="text-xs text-muted-foreground">No open exposure to map.</p>
      </section>
    )
  }

  const maxPct = Math.max(...symbols.map(s => s.pct), 1)

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-medium">Concentration heatmap</h2>
        <span className="text-[11px] text-muted-foreground">heat = share of notional</span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {symbols.map(({ sym, notional, pct }) => {
          const over = capPct !== null && pct > capPct
          return (
            <div
              key={sym}
              title={`${sym} · ${pct.toFixed(1)}% · ${usd(notional)}${over ? ' · OVER CAP' : ''}`}
              className={`flex flex-col gap-0.5 rounded-lg border p-2.5 ${heatClass(pct / maxPct)} ${
                over ? 'ring-2 ring-red-500' : ''
              }`}
            >
              <code className="truncate font-mono text-xs font-semibold">{sym}</code>
              <span className="tabular-nums text-sm font-semibold leading-none">{pct.toFixed(1)}%</span>
              <span className="tabular-nums text-[10px] opacity-70">{usd(notional)}</span>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {capPct !== null
          ? <>Red ring = breaches the {capPct}% per-symbol cap. </>
          : <>No per-symbol cap set. </>}
        Shows concentration, not price correlation — a correlation matrix
        needs a price-history feed (roadmap).
      </p>
    </section>
  )
}
