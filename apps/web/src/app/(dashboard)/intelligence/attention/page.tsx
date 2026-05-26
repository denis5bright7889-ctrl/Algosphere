/**
 * Attention — social narrative-attention intelligence.
 *
 * Per the brief Section 21: narrative dominance, social acceleration,
 * attention concentration. Sourced from X v2 mention counts. Degrades
 * honestly when X API credits are depleted (a 402) — shows the reason
 * rather than faking attention data.
 */
import { loadIntelContext } from '../_components/guard'
import { composeAttentionBoard, type AttentionView, type AttentionState } from '@/lib/attention-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Attention' }
export const dynamic  = 'force-dynamic'

export default async function AttentionPage() {
  await loadIntelContext()
  const board = await composeAttentionBoard()

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Attention</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Where social attention is concentrating and accelerating across crypto
          narratives. Sourced from X mention velocity — pairs with Smart Money
          and Narrative to separate genuine flow from hype.
        </p>
      </header>

      {!board.available ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
          <p className="font-semibold">Attention feed unavailable</p>
          <p className="mt-1 text-xs">
            {board.reason}. {board.reason?.includes('credits')
              ? 'The X API meters reads — attention resumes automatically when credits refresh or are topped up. The engine and webhook are wired and ready.'
              : 'The engine is wired; this resolves when the X API responds.'}
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-violet-500/25 bg-card p-5 shadow-sm">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Attention Landscape</span>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{board.headline}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
              {board.dominant && <Tag label="Dominant" value={board.dominant} tone="text-emerald-400" />}
              {board.surging  && <Tag label="Surging"  value={board.surging}  tone="text-violet-400" />}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.views.map((v) => <AttentionCard key={v.label} view={v} />)}
          </div>
        </>
      )}
    </main>
  )
}

function Tag({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="rounded-md border border-border/60 bg-background/40 px-2 py-1">
      <span className="uppercase tracking-wider text-muted-foreground">{label}: </span>
      <span className={cn('font-semibold', tone)}>{value}</span>
    </span>
  )
}

function AttentionCard({ view }: { view: AttentionView }) {
  const tone = stateTone(view.state)
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-sm', tone.border)}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{view.label}</h2>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
            {view.state}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={cn('text-lg font-semibold tabular-nums leading-none',
            view.acceleration_pct >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {view.acceleration_pct >= 0 ? '+' : ''}{Math.round(view.acceleration_pct)}%
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">24h accel</span>
        </div>
      </header>
      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{view.narrative}</p>
      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
        <span>Mentions 24h: <span className="tabular-nums text-foreground/80">{view.mentions_24h.toLocaleString()}</span></span>
        <span>Share: <span className="tabular-nums text-foreground/80">{view.share_of_attention_pct.toFixed(1)}%</span></span>
      </div>
    </section>
  )
}

function stateTone(s: AttentionState): { border: string; pill: string } {
  switch (s) {
    case 'Surging': return { border: 'border-violet-500/35', pill: 'bg-violet-500/15 text-violet-400 border-violet-500/35' }
    case 'Rising':  return { border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Steady':  return { border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Cooling': return { border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Quiet':   return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
    case 'N/A':     return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
