/**
 * Conviction — institutional multi-layer agreement view.
 *
 * Server-rendered: composes the Conviction view for a default basket
 * (BTC, ETH, EUR, AAPL) so the page loads with real institutional
 * intelligence rather than an empty shell. Each card shows the layer
 * breakdown (Momentum / Regime / Volatility / Smart Money / Participation
 * / Macro), the composite conviction, and the institutional narrative.
 *
 * Per the platform philosophy: no raw formulas, no thresholds, no engine
 * internals. Only states, bias, strength bars, and the narrative.
 */
import { loadIntelContext } from '../_components/guard'
import { composeConviction, type ConvictionView, type ConvictionLayer } from '@/lib/conviction'
import { composeStressView, type StressView, type StressLabel } from '@/lib/stress-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Conviction' }
export const dynamic  = 'force-dynamic'

const DEFAULT_BASKET = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'XAUUSD', 'AAPL']

export default async function ConvictionPage() {
  await loadIntelContext()    // auth + tier resolution
  // Compose the environment read and the per-symbol views in parallel — Stress
  // is the universe-level frame that calibrates how to read per-symbol conviction.
  const [stress, views] = await Promise.all([
    composeStressView(),
    Promise.all(DEFAULT_BASKET.map((s) => composeConviction(s))),
  ])

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Conviction</h1>
        <p className="text-sm text-muted-foreground">
          Multi-layer agreement across momentum, regime, volatility, smart money,
          participation, and macro. The composite reflects what we KNOW — layers
          we can't source are excluded, never imagined.
        </p>
      </header>

      <EnvironmentStrip stress={stress} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {views.map((v) => <ConvictionCard key={v.symbol} view={v} />)}
      </div>
    </main>
  )
}

// ── Environment strip — Stress read across the top of the conviction view ─

function EnvironmentStrip({ stress }: { stress: StressView }) {
  const tone = stressTone(stress.label)
  return (
    <section className={cn('flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm', tone.border)}>
      <div className="flex flex-1 items-center gap-3">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Environment</span>
          <span className={cn('text-lg font-semibold tracking-tight', tone.text)}>{stress.label}</span>
        </div>
        <div className="hidden h-10 w-px bg-border/60 sm:block" />
        <p className="hidden flex-1 text-xs text-muted-foreground sm:block">{stress.narrative}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className={cn('text-xl font-semibold tabular-nums leading-none', tone.text)}>{stress.score}</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">stress · {stress.posture}</span>
      </div>
    </section>
  )
}

function stressTone(label: StressLabel): { text: string; border: string } {
  switch (label) {
    case 'Aggressive Conditions':  return { text: 'text-emerald-400', border: 'border-emerald-500/30' }
    case 'Stable Conditions':      return { text: 'text-sky-400',     border: 'border-sky-500/30' }
    case 'Defensive Environment':  return { text: 'text-amber-400',   border: 'border-amber-500/30' }
    case 'Market Stress Elevated': return { text: 'text-rose-400',    border: 'border-rose-500/40' }
    default:                       return { text: 'text-muted-foreground', border: 'border-border' }
  }
}

// ── Card ─────────────────────────────────────────────────────────────────

function ConvictionCard({ view }: { view: ConvictionView }) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{view.symbol}</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {view.asset_class}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{view.narrative}</p>
        </div>
        <CompositePill view={view} />
      </header>

      <div className="mt-4 space-y-2">
        {view.layers.map((l) => <LayerRow key={l.name} layer={l} />)}
      </div>

      <footer className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        <span>
          Continuation <span className="tabular-nums text-foreground">{pct(view.probability.continuation)}</span>
          {' · '}Fade <span className="tabular-nums text-foreground">{pct(view.probability.fade)}</span>
          {' · '}Chop <span className="tabular-nums text-foreground">{pct(view.probability.chop)}</span>
        </span>
        {view.partial && <span className="text-amber-400">Partial — see N/A layers</span>}
      </footer>
    </section>
  )
}

function CompositePill({ view }: { view: ConvictionView }) {
  const tone =
    view.composite_bias === 'Bullish'  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
    view.composite_bias === 'Bearish'  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' :
                                          'bg-muted/20 text-muted-foreground border-border'
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={cn('rounded-md border px-2 py-1 text-xs font-semibold', tone)}>
        {view.composite} {view.composite_bias}
      </span>
    </div>
  )
}

function LayerRow({ layer }: { layer: ConvictionLayer }) {
  const tone = biasTone(layer.bias)
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {layer.name}
      </span>
      <span className={cn('w-20 shrink-0 text-xs font-semibold', tone)}>{layer.bias}</span>
      <StrengthBars value={layer.strength} bias={layer.bias} />
      <span className="ml-auto truncate text-xs text-muted-foreground" title={layer.signal}>
        {layer.signal}
      </span>
    </div>
  )
}

function StrengthBars({ value, bias }: { value: number; bias: ConvictionLayer['bias'] }) {
  const tone = biasTone(bias)
  return (
    <span className="flex items-center gap-0.5" aria-label={`strength ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn('h-2 w-2 rounded-sm border border-border/40',
            i <= value ? bias === 'N/A' ? 'bg-muted/30' : tone.replace('text-', 'bg-').split(' ')[0] : 'bg-transparent')}
        />
      ))}
    </span>
  )
}

function biasTone(bias: ConvictionLayer['bias']): string {
  switch (bias) {
    case 'Bullish': return 'text-emerald-400'
    case 'Bearish': return 'text-rose-400'
    case 'Neutral': return 'text-sky-400'
    case 'Mixed':   return 'text-amber-400'
    case 'N/A':     return 'text-muted-foreground'
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
