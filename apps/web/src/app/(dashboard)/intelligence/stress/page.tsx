/**
 * Market Stress — institutional environment dashboard.
 *
 * Per the brief: surfaces one universe-level state (Market Stress Elevated
 * / Defensive Environment / Stable Conditions / Aggressive Conditions),
 * the contributing components, the recommended institutional posture, and
 * a narrative. Components that require data we don't yet have (liquidity
 * spreads, true correlation matrix) are listed honestly as Awaiting Data
 * rather than faked.
 */
import { loadIntelContext } from '../_components/guard'
import { composeStressView, type StressView, type StressComponent, type StressLabel } from '@/lib/stress-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Market Stress' }
export const dynamic  = 'force-dynamic'

export default async function StressPage() {
  await loadIntelContext()
  const view = await composeStressView()

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Market Stress</h1>
        <p className="text-sm text-muted-foreground">
          Universe-level environment read across volatility, macro pressure,
          and momentum cohesion. The posture is institutional guidance — not
          a position recommendation.
        </p>
      </header>

      <StressHeader view={view} />

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Components
        </h2>
        <div className="space-y-3">
          {view.components.map((c) => <ComponentRow key={c.name} component={c} />)}
        </div>
        {view.partial && (
          <p className="mt-4 text-xs text-amber-400">
            Some components are awaiting data — the composite is computed over
            what's available, not imagined.
          </p>
        )}
      </section>
    </main>
  )
}

// ── Header (the dominant state read) ─────────────────────────────────────

function StressHeader({ view }: { view: StressView }) {
  const tone = labelTone(view.label)
  return (
    <section className={cn('rounded-xl border bg-card p-6 shadow-sm', tone.border)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Environment</div>
          <h2 className={cn('mt-1 text-3xl font-semibold tracking-tight', tone.text)}>
            {view.label}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{view.narrative}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreRing score={view.score} tone={tone.text} />
          <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', tone.pill)}>
            Posture: {view.posture}
          </span>
        </div>
      </div>
    </section>
  )
}

function ScoreRing({ score, tone }: { score: number; tone: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={cn('text-3xl font-semibold tabular-nums leading-none', tone)}>{score}</span>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">stress</span>
    </div>
  )
}

// ── Component row ────────────────────────────────────────────────────────

function ComponentRow({ component }: { component: StressComponent }) {
  if (!component.available) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
          {component.name}
        </span>
        <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground">Awaiting</span>
        <span className="ml-auto truncate text-xs text-muted-foreground" title={component.signal}>
          {component.signal}
        </span>
      </div>
    )
  }
  const pct = Math.round(component.stress * 100)
  const tone =
    component.stress >= 0.6 ? 'bg-rose-400'   :
    component.stress >= 0.4 ? 'bg-amber-400'  :
                              'bg-emerald-400'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 text-sm">
        <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
          {component.name}
        </span>
        <span className="w-12 shrink-0 text-xs font-semibold tabular-nums">{pct}%</span>
        <span className="ml-auto truncate text-xs text-muted-foreground" title={component.signal}>
          {component.signal}
        </span>
      </div>
      <div className="ml-36 h-1.5 overflow-hidden rounded-full bg-muted/30">
        <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Tones ────────────────────────────────────────────────────────────────

function labelTone(label: StressLabel): { text: string; border: string; pill: string } {
  switch (label) {
    case 'Aggressive Conditions':
      return { text: 'text-emerald-400', border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Stable Conditions':
      return { text: 'text-sky-400',     border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Defensive Environment':
      return { text: 'text-amber-400',   border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Market Stress Elevated':
      return { text: 'text-rose-400',    border: 'border-rose-500/40',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
    default:
      return { text: 'text-muted-foreground', border: 'border-border', pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
