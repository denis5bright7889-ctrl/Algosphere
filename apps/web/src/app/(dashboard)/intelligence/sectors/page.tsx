/**
 * Sector intelligence — crypto sector rotation, institutional read.
 *
 * Aggregates the CoinGecko top-250 by curated sector taxonomy; never
 * fabricates sector flows we don't have. Sectors below the minimum
 * cohort threshold render as "Insufficient cohort" — not a guess.
 */
import { loadIntelContext } from '../_components/guard'
import { composeSectorIntel, type SectorRow, type SectorState, type Sustainability, type RiskLevel } from '@/lib/sector-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Sector Intelligence — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function SectorsPage() {
  await loadIntelContext()
  const view = await composeSectorIntel()

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sector <span className="text-gradient">Intelligence</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Institutional read of crypto sector rotation — strength, breadth, and sustainability
          aggregated from the CoinGecko top-250 by curated sector taxonomy.
          <span className="ml-1 text-muted-foreground/70">
            Crypto-only — we don&apos;t fabricate ETF flows or institutional positioning.
          </span>
        </p>
      </header>

      {view.partial && (
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          Sector data unavailable{view.reason ? ` — ${view.reason}` : '.'}
        </div>
      )}

      {!view.partial && (
        <>
          <SectorHeatmap rows={view.sectors} />
          <section className="space-y-3">
            {view.sectors.map((row) => <SectorCard key={row.sector} row={row} />)}
          </section>
        </>
      )}

      <footer className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Source: CoinGecko top {Math.max(view.universe_size, 0)} bucketed by sector taxonomy</span>
        <span>Updated {new Date(view.generated_at).toLocaleTimeString()}</span>
      </footer>
    </main>
  )
}

// ── Heatmap (simple coloured-cell grid; no viz lib) ──────────────────────

function SectorHeatmap({ rows }: { rows: SectorRow[] }) {
  // Map each sector's avg_change_24h to a tone. We cap intensity at ±10%
  // because sectoral 24h moves above that are speculative outliers.
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-3">
      <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Sector heatmap · 24h
      </h2>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {rows.map((r) => {
          const intensity = Math.min(1, Math.abs(r.avg_change_24h) / 10)
          const tone = r.avg_change_24h >= 0
            ? `rgba(52, 211, 153, ${intensity * 0.32 + 0.05})`
            : `rgba(244, 114, 128, ${intensity * 0.32 + 0.05})`
          const borderTone = r.avg_change_24h >= 0
            ? `rgba(52, 211, 153, ${intensity * 0.6 + 0.1})`
            : `rgba(244, 114, 128, ${intensity * 0.6 + 0.1})`
          return (
            <div
              key={r.sector}
              className="rounded-lg border p-2.5"
              // eslint-disable-next-line react/forbid-dom-props
              style={{ backgroundColor: tone, borderColor: borderTone }}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate text-xs font-semibold">{r.label}</span>
                <span className={cn(
                  'shrink-0 text-xs font-bold tabular-nums',
                  r.avg_change_24h >= 0 ? 'text-emerald-300' : 'text-rose-300',
                )}>
                  {r.avg_change_24h >= 0 ? '+' : ''}{r.avg_change_24h}%
                </span>
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {r.advancing}/{r.count} advancing · {r.participation}%
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Sector card (state + narrative + leaders/laggards) ───────────────────

function SectorCard({ row }: { row: SectorRow }) {
  return (
    <article className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{row.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.narrative}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <StateChip state={row.state} />
          <SustainabilityChip s={row.sustainability} />
          <RiskChip risk={row.risk_level} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Metric label="Cohort"        value={`${row.count}`} />
        <Metric label="Participation" value={`${row.participation}%`} />
        <Metric label="Avg 24h"       value={`${row.avg_change_24h >= 0 ? '+' : ''}${row.avg_change_24h}%`}
                tone={row.avg_change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
        <Metric label="Median 24h"    value={`${row.median_change_24h >= 0 ? '+' : ''}${row.median_change_24h}%`} />
      </div>

      {(row.leaders.length > 0 || row.laggards.length > 0) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ConstituentList title="Leaders"  rows={row.leaders}  tone="text-emerald-300" />
          <ConstituentList title="Laggards" rows={row.laggards} tone="text-rose-300" />
        </div>
      )}
    </article>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tone ?? '')}>{value}</div>
    </div>
  )
}

function ConstituentList({ title, rows, tone }: {
  title: string; rows: SectorRow['leaders']; tone: string
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <ul className="space-y-1">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase">{c.symbol}</span>
            <span className={cn('tabular-nums font-semibold', tone)}>
              {(c.price_change_percentage_24h ?? 0) >= 0 ? '+' : ''}
              {(c.price_change_percentage_24h ?? 0).toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Chips ────────────────────────────────────────────────────────────────

function StateChip({ state }: { state: SectorState }) {
  const tone =
    state === 'Accelerating'        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' :
    state === 'Strengthening'       ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300/90' :
    state === 'Distributing'        ? 'border-rose-500/40 bg-rose-500/15 text-rose-300' :
    state === 'Weakening'           ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' :
    state === 'Insufficient cohort' ? 'border-border bg-muted/20 text-muted-foreground' :
                                       'border-border bg-muted/20 text-muted-foreground'
  return <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tone)}>{state}</span>
}
function SustainabilityChip({ s }: { s: Sustainability }) {
  if (s === 'N/A') return null
  const tone =
    s === 'Healthy'  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' :
    s === 'Moderate' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' :
                       'border-rose-500/40 bg-rose-500/15 text-rose-300'
  return <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-semibold', tone)}>Sustain: {s}</span>
}
function RiskChip({ risk }: { risk: RiskLevel }) {
  if (risk === 'N/A') return null
  const tone =
    risk === 'High'     ? 'border-rose-500/40 bg-rose-500/15 text-rose-300' :
    risk === 'Elevated' ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' :
    risk === 'Moderate' ? 'border-border bg-muted/20 text-muted-foreground' :
                          'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  return <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-semibold', tone)}>Risk: {risk}</span>
}
