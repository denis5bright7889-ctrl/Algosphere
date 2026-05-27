/**
 * Volatility intelligence — live engine ATR ranking + static registry tiers.
 *
 * The two reads are kept visually distinct: the ranked list is REAL
 * measured ATR from the engine's regime snapshots ("live engine"); the
 * tier grid is the curated registry taxonomy ("static catalog"). We never
 * present the catalog tier as a measurement.
 */
import { loadIntelContext } from '../_components/guard'
import { composeVolatilityView, type LiveVolRow, type CatalogVolRow } from '@/lib/volatility-rank'
import { OpenChartButton } from '@/components/charts'
import type { AssetClass } from '@/lib/market-universe'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Volatility Intelligence — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function VolatilityPage() {
  await loadIntelContext()
  const view = await composeVolatilityView()

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Volatility <span className="text-gradient">Intelligence</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where risk is expanding. The ranking is <span className="font-semibold text-foreground/80">live measured</span> ATR
          from the engine&apos;s regime scans; the tier grid below is the
          <span className="font-semibold text-foreground/80"> static registry</span> taxonomy — distinct on purpose.
        </p>
      </header>

      {/* Live engine ATR ranking */}
      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Live engine · ATR ranking
          </h2>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
            Live · {view.live_engine_count} scanned
          </span>
        </div>
        {view.live.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No engine ATR readings on record yet{view.reason ? ` — ${view.reason}` : '.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {view.live.map((r, i) => <LiveRow key={r.symbol} row={r} rank={i + 1} max={view.live[0]!.atr_pct} />)}
          </div>
        )}
      </section>

      {/* Static registry tiers */}
      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Static catalog · volatility tiers
          </h2>
          <span className="rounded-full border border-border bg-muted/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Catalog · {view.catalog_size} instruments
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <TierColumn title="High"   rows={view.catalog_by_tier.high}   tone="rose" />
          <TierColumn title="Medium" rows={view.catalog_by_tier.medium} tone="amber" />
          <TierColumn title="Low"    rows={view.catalog_by_tier.low}    tone="emerald" />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Tiers are curated catalog metadata (institutional classification), not real-time measurements.
        </p>
      </section>

      <footer className="text-[11px] text-muted-foreground">
        Updated {new Date(view.generated_at).toLocaleTimeString()}
      </footer>
    </main>
  )
}

function LiveRow({ row, rank, max }: { row: LiveVolRow; rank: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (row.atr_pct / max) * 100) : 0
  const tone =
    row.level === 'High'     ? 'bg-rose-400' :
    row.level === 'Elevated' ? 'bg-amber-400' :
    row.level === 'Normal'   ? 'bg-sky-400' : 'bg-emerald-400'
  return (
    <div className="flex items-center gap-3">
      <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{rank}</span>
      <span className="w-20 shrink-0 font-mono text-xs font-semibold">{row.symbol}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/30">
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div className={cn('h-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums">{(row.atr_pct * 100).toFixed(2)}%</span>
      <span className="hidden w-16 shrink-0 text-right text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">{row.level}</span>
      <OpenChartButton symbol={row.symbol} assetClass={row.asset_class as AssetClass} variant="icon" />
    </div>
  )
}

function TierColumn({ title, rows, tone }: { title: string; rows: CatalogVolRow[]; tone: 'rose' | 'amber' | 'emerald' }) {
  const head =
    tone === 'rose'    ? 'text-rose-300' :
    tone === 'amber'   ? 'text-amber-300' : 'text-emerald-300'
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      <h3 className={cn('mb-2 text-xs font-bold uppercase tracking-wider', head)}>{title} · {rows.length}</h3>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.symbol} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate">{r.display_name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{r.symbol}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
