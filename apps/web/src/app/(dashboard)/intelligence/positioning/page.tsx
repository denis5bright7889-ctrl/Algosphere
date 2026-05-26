/**
 * Positioning — leverage / crowding / liquidation risk.
 *
 * Per the brief Section 11: surface overcrowded longs / panic shorts /
 * leverage stress at the institutional level. Bybit funding-rate +
 * open-interest derivation, exposed as STATE labels not raw % numbers.
 */
import { loadIntelContext } from '../_components/guard'
import { composePositioningBoard, type PositioningView, type PositioningState } from '@/lib/positioning-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Positioning' }
export const dynamic  = 'force-dynamic'

const usd = (n: number | null) => {
  if (n === null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export default async function PositioningPage() {
  await loadIntelContext()
  const board = await composePositioningBoard()

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Positioning</h1>
        <p className="text-sm text-muted-foreground">
          Where leverage is crowded across the crypto perps universe.
          Source: Bybit public funding + open-interest. Equities / FX
          positioning needs separate data sources (deferred).
        </p>
      </header>

      <SummaryStrip summary={board.summary} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {board.views.map((v) => <PositioningCard key={v.symbol} view={v} />)}
      </div>

      {board.partial && (
        <p className="text-xs text-amber-400">
          Some symbols are showing as Unknown — Bybit feed responded partially.
          The summary excludes them; refresh in a few seconds for the full read.
        </p>
      )}
    </main>
  )
}

// ── Summary strip ────────────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: { label: string; score: number; narrative: string } }) {
  const tone =
    summary.label === 'Long-skewed'  ? 'border-emerald-500/30 text-emerald-400' :
    summary.label === 'Short-skewed' ? 'border-rose-500/30 text-rose-400'       :
    summary.label === 'Balanced'     ? 'border-sky-500/30 text-sky-400'         :
                                        'border-border text-muted-foreground'
  const [borderClass, textClass] = tone.split(' ')
  return (
    <section className={cn('flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:gap-4', borderClass)}>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Universe positioning</span>
        <span className={cn('text-lg font-semibold tracking-tight', textClass)}>{summary.label}</span>
      </div>
      <div className="hidden h-10 w-px bg-border/60 sm:block" />
      <p className="text-xs text-muted-foreground sm:flex-1">{summary.narrative}</p>
      <div className="flex shrink-0 items-baseline gap-1">
        <span className={cn('text-2xl font-semibold tabular-nums leading-none', textClass)}>{summary.score}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">crowding</span>
      </div>
    </section>
  )
}

// ── Per-asset card ───────────────────────────────────────────────────────

function PositioningCard({ view }: { view: PositioningView }) {
  const tone = stateTone(view.state)
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-sm', tone.border)}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{view.symbol.replace(/USDT$/, '')}</h2>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
            {view.state}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className={cn('text-lg font-semibold tabular-nums leading-none', tone.text)}>{view.stress_score}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">stress</span>
        </div>
      </header>

      <p className="mt-3 text-xs text-muted-foreground">{view.signal}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Cell label="OI"            value={usd(view.oi_usd)} />
        <Cell label="OI scale"      value={view.oi_scale} />
      </div>
    </section>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-semibold">{value}</div>
    </div>
  )
}

function stateTone(state: PositioningState): { border: string; pill: string; text: string } {
  switch (state) {
    case 'Euphoric Long':
      return { border: 'border-rose-500/40',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/30',     text: 'text-rose-400' }
    case 'Crowded Long':
      return { border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', text: 'text-emerald-400' }
    case 'Balanced':
      return { border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30',         text: 'text-sky-400' }
    case 'Crowded Short':
      return { border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30',   text: 'text-amber-400' }
    case 'Panic Short':
      return { border: 'border-violet-500/40',  pill: 'bg-violet-500/15 text-violet-400 border-violet-500/30', text: 'text-violet-400' }
    default:
      return { border: 'border-border', pill: 'bg-muted/20 text-muted-foreground border-border', text: 'text-muted-foreground' }
  }
}
