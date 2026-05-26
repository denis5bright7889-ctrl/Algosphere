/**
 * Momentum Intelligence — institutional phase view across the watchlist.
 *
 * Per the brief: answers "is momentum healthy / sustainable / overcrowded /
 * weakening / accelerating?" Each card shows the phase, direction, quality,
 * sustainability, and a one-line institutional narrative. Raw DER/autocorr/
 * ATR values are deliberately not exposed.
 */
import { loadIntelContext } from '../_components/guard'
import { composeMomentumView, type MomentumView } from '@/lib/momentum-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Momentum Phase' }
export const dynamic  = 'force-dynamic'

const BASKET = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
                'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD',
                'AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ']

export default async function MomentumPage() {
  await loadIntelContext()
  const views = await Promise.all(BASKET.map((s) => composeMomentumView(s)))
  // Sort by score so the strongest momentum surfaces first — institutional ranking
  const sorted = views.sort((a, b) => b.score - a.score)

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Momentum Phase</h1>
          <p className="text-sm text-muted-foreground">
            Universe-wide phase detection across FX, crypto, metals, and equities —
            Accumulation through Collapse Risk, ranked by health score.
          </p>
        </div>
        <a href="/intelligence/token-momentum"
           className="shrink-0 rounded-md border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300">
          Token-level detail →
        </a>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((v) => <MomentumCard key={v.symbol} view={v} />)}
      </div>
    </main>
  )
}

function MomentumCard({ view }: { view: MomentumView }) {
  const phaseTone = phaseColour(view.phase)
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-sm', phaseTone.border)}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{view.symbol}</h2>
            <DirectionArrow direction={view.direction} />
          </div>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', phaseTone.pill)}>
            {view.phase}
          </span>
        </div>
        <ScoreDial score={view.score} />
      </header>

      <p className="mt-3 text-xs text-muted-foreground">{view.signal}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Cell label="Quality"        value={view.quality} />
        <Cell label="Sustainability" value={view.sustainability} />
        <Cell label="Direction"      value={view.direction} />
        <Cell label="State"          value={
          view.overcrowded   ? 'Overcrowded' :
          view.accelerating  ? 'Accelerating' :
          view.weakening     ? 'Weakening' :
          'Steady'
        } />
      </div>

      {view.partial && (
        <p className="mt-2 text-[10px] text-amber-400">
          Partial — limited history; classification provisional.
        </p>
      )}
    </section>
  )
}

// ── Visual atoms ──────────────────────────────────────────────────────────

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-semibold">{value}</div>
    </div>
  )
}

function DirectionArrow({ direction }: { direction: MomentumView['direction'] }) {
  const tone =
    direction === 'Up'   ? 'text-emerald-400' :
    direction === 'Down' ? 'text-rose-400'    : 'text-muted-foreground'
  const arrow =
    direction === 'Up'   ? '↑' :
    direction === 'Down' ? '↓' :
    direction === 'Sideways' ? '→' : '·'
  return <span className={cn('text-sm font-bold', tone)} aria-label={direction}>{arrow}</span>
}

function ScoreDial({ score }: { score: number }) {
  const tone =
    score >= 75 ? 'text-emerald-400' :
    score >= 55 ? 'text-sky-400'     :
    score >= 35 ? 'text-amber-400'   :
                  'text-rose-400'
  return (
    <div className="flex flex-col items-end">
      <div className={cn('text-xl font-semibold tabular-nums leading-none', tone)}>{score}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">health</div>
    </div>
  )
}

function phaseColour(phase: MomentumView['phase']): { pill: string; border: string } {
  switch (phase) {
    case 'Trending':
      return { pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', border: 'border-emerald-500/20' }
    case 'Expansion':
      return { pill: 'bg-blue-500/15 text-blue-400 border-blue-500/30', border: 'border-blue-500/20' }
    case 'Accumulation':
      return { pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30', border: 'border-sky-500/20' }
    case 'Parabolic':
      return { pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30', border: 'border-amber-500/30' }
    case 'Exhaustion':
      return { pill: 'bg-amber-600/15 text-amber-300 border-amber-600/40', border: 'border-amber-600/30' }
    case 'Distribution':
      return { pill: 'bg-muted/20 text-muted-foreground border-border', border: 'border-border' }
    case 'Collapse Risk':
      return { pill: 'bg-rose-500/15 text-rose-400 border-rose-500/40', border: 'border-rose-500/30' }
    default:
      return { pill: 'bg-muted/20 text-muted-foreground border-border', border: 'border-border' }
  }
}
