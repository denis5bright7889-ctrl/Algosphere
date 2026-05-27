/**
 * Market breadth — institutional read of participation quality.
 *
 * Two sources kept clearly separated so a 250-sample CoinGecko breadth
 * read is never confused with a ~30-symbol engine-scanned breadth. Each
 * row carries its own sample size and source label.
 */
import { loadIntelContext } from '../_components/guard'
import { composeBreadthView, type BreadthSlice, type BreadthState, type HealthLabel, type Posture } from '@/lib/breadth-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Market Breadth — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function BreadthPage() {
  await loadIntelContext()
  const view = await composeBreadthView()

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Market <span className="text-gradient">Breadth</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Participation quality across the universe — advancing vs declining,
          leadership concentration, and a composite health score.
          Sources and sample sizes are surfaced on every row.
        </p>
      </header>

      <CompositeCard score={view.health_score} posture={view.posture} narrative={view.narrative} />

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Primary — Crypto (CoinGecko top 250)
        </h2>
        <BreadthRow slice={view.crypto} prominent />
      </section>

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Engine-scanned · by class
        </h2>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Derived from the most recent regime snapshots per symbol (a
          ~30-symbol universe). Labelled separately so it isn&apos;t read as
          full-market breadth.
        </p>
        <div className="space-y-2">
          {view.by_class.map((s) => <BreadthRow key={s.class_label} slice={s} />)}
        </div>
      </section>

      <footer className="text-[11px] text-muted-foreground">
        Updated {new Date(view.generated_at).toLocaleTimeString()}
      </footer>
    </main>
  )
}

// ── Composite ────────────────────────────────────────────────────────────

function CompositeCard({ score, posture, narrative }: { score: number; posture: Posture; narrative: string }) {
  const tone =
    score >= 70 ? 'border-emerald-500/40 text-emerald-300' :
    score >= 45 ? 'border-amber-500/30 text-amber-300' :
                  'border-rose-500/40 text-rose-300'
  return (
    <section className={cn('rounded-xl border bg-card/40 p-5', tone.split(' ')[0])}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Composite health</div>
          <div className={cn('mt-1 text-3xl font-semibold tabular-nums', tone.split(' ')[1])}>{score}<span className="ml-1 text-base text-muted-foreground/70">/100</span></div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{narrative}</p>
        </div>
        <PostureChip posture={posture} />
      </div>
    </section>
  )
}

function PostureChip({ posture }: { posture: Posture }) {
  const tone =
    posture === 'Risk-On'  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' :
    posture === 'Risk-Off' ? 'border-rose-500/40 bg-rose-500/15 text-rose-300' :
    posture === 'Mixed'    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' :
                             'border-border bg-muted/20 text-muted-foreground'
  return (
    <span className={cn('shrink-0 rounded-md border px-3 py-1 text-xs font-bold uppercase tracking-wider', tone)}>
      Posture: {posture}
    </span>
  )
}

// ── Breadth row ──────────────────────────────────────────────────────────

function BreadthRow({ slice, prominent }: { slice: BreadthSlice; prominent?: boolean }) {
  if (!slice.available) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-border/60 bg-background/30 px-3 py-2">
        <span className="text-xs font-semibold">{slice.class_label}</span>
        <span className="text-xs text-muted-foreground">{slice.reason ?? 'No samples.'}</span>
      </div>
    )
  }
  return (
    <div className={cn('rounded-md border border-border/60 bg-background/40 p-3', prominent && 'border-amber-500/30')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-sm font-semibold', prominent && 'text-base')}>{slice.class_label}</span>
        <div className="flex items-center gap-1.5">
          <StateChip state={slice.state} />
          <HealthChip health={slice.health} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Sample <span className="font-semibold text-foreground/90 tabular-nums">{slice.sample_size}</span></span>
        <span>Advancing <span className="font-semibold text-emerald-300 tabular-nums">{slice.advancing}</span></span>
        <span>Declining <span className="font-semibold text-rose-300 tabular-nums">{slice.declining}</span></span>
        <span>% advancing <span className="font-semibold text-foreground/90 tabular-nums">{slice.pct_advancing}%</span></span>
        <span>Median <span className={cn('font-semibold tabular-nums', slice.median_change >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
          {slice.median_change >= 0 ? '+' : ''}{slice.median_change}{slice.source === 'engine-scanned' ? '' : '%'}
        </span></span>
      </div>
      <BreadthBar pct={slice.pct_advancing} />
    </div>
  )
}

function BreadthBar({ pct }: { pct: number }) {
  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted/30">
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div className="bg-emerald-400/80" style={{ width: `${pct}%` }} />
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div className="bg-rose-400/70"    style={{ width: `${100 - pct}%` }} />
    </div>
  )
}

function StateChip({ state }: { state: BreadthState }) {
  const tone =
    state === 'Broad'     ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' :
    state === 'Selective' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' :
    state === 'Narrow'    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' :
    state === 'Weak'      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300' :
                            'border-border bg-muted/20 text-muted-foreground'
  return <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tone)}>{state}</span>
}
function HealthChip({ health }: { health: HealthLabel }) {
  if (health === 'N/A') return null
  const tone =
    health === 'Healthy'  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' :
    health === 'Mixed'    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' :
                            'border-rose-500/30 bg-rose-500/10 text-rose-300'
  return <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-semibold', tone)}>{health}</span>
}
