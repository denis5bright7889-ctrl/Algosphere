/**
 * Participation — institutional "who is driving price" breakdown.
 *
 * Per the brief: separates retail / whale / smart-money / aggressive flow,
 * exposes per-asset quality, strength, and imbalance. Retail channel is
 * honestly N/A until exchange order-side aggregates are wired.
 */
import { loadIntelContext } from '../_components/guard'
import { composeParticipationBoard, type ParticipationView, type ParticipationChannel, type ParticipationImbalance, type ParticipationQuality } from '@/lib/participation-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Participation' }
export const dynamic  = 'force-dynamic'

export default async function ParticipationPage() {
  await loadIntelContext()
  const board = await composeParticipationBoard({ window: '24h', limit: 24 })
  const sorted = board.views.sort((a, b) => b.strength - a.strength)

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Participation</h1>
        <p className="text-sm text-muted-foreground">
          Who is driving price — smart money, whales, and aggression by asset.
          Equities/FX participation requires exchange-side aggregates and
          surfaces once wired.
        </p>
      </header>

      {board.reason && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] px-4 py-3 text-xs text-cyan-200">
          {board.reason}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No active participation in the 24h window yet — the screener returned an empty universe.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((v) => <ParticipationCard key={`${v.chain}-${v.symbol}`} view={v} />)}
        </div>
      )}
    </main>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────

function ParticipationCard({ view }: { view: ParticipationView }) {
  const qualityTone = qualityColour(view.quality)
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-sm', qualityTone.border)}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{view.symbol}</h2>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{view.chain}</span>
          </div>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', qualityTone.pill)}>
            {view.quality} quality
          </span>
        </div>
        <StrengthDial strength={view.strength} imbalance={view.imbalance} />
      </header>

      <p className="mt-3 text-xs text-muted-foreground">{view.narrative}</p>

      <div className="mt-3 space-y-2">
        {view.channels.map((c) => <ChannelRow key={c.name} channel={c} />)}
      </div>
    </section>
  )
}

// ── Channel row ───────────────────────────────────────────────────────────

function ChannelRow({ channel }: { channel: ParticipationChannel }) {
  if (!channel.available) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {channel.name}
        </span>
        <span className="text-muted-foreground italic" title={channel.signal}>
          Awaiting data
        </span>
      </div>
    )
  }
  const tone = biasTone(channel.bias)
  const pct  = Math.round(channel.intensity * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {channel.name}
        </span>
        <span className={cn('w-14 shrink-0 text-[10px] font-semibold', tone)}>{channel.bias}</span>
        <span className="ml-auto truncate text-[10px] text-muted-foreground" title={channel.signal}>
          {channel.signal}
        </span>
      </div>
      <div className="ml-20 h-1 overflow-hidden rounded-full bg-muted/30">
        <div className={cn('h-full', barTone(channel.bias))} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Visual atoms ──────────────────────────────────────────────────────────

function StrengthDial({ strength, imbalance }: { strength: number; imbalance: ParticipationImbalance }) {
  const tone =
    imbalance === 'Buyers-led'  ? 'text-emerald-400' :
    imbalance === 'Sellers-led' ? 'text-rose-400'    :
    imbalance === 'Balanced'    ? 'text-sky-400'     :
                                  'text-muted-foreground'
  return (
    <div className="flex flex-col items-end">
      <span className={cn('text-xl font-semibold tabular-nums leading-none', tone)}>{strength}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {imbalance}
      </span>
    </div>
  )
}

function biasTone(bias: ParticipationChannel['bias']): string {
  switch (bias) {
    case 'Bullish': return 'text-emerald-400'
    case 'Bearish': return 'text-rose-400'
    case 'Neutral': return 'text-sky-400'
    case 'N/A':     return 'text-muted-foreground'
  }
}

function barTone(bias: ParticipationChannel['bias']): string {
  switch (bias) {
    case 'Bullish': return 'bg-emerald-400'
    case 'Bearish': return 'bg-rose-400'
    case 'Neutral': return 'bg-sky-400'
    case 'N/A':     return 'bg-muted/30'
  }
}

function qualityColour(quality: ParticipationQuality): { border: string; pill: string } {
  switch (quality) {
    case 'High':     return { border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Moderate': return { border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Low':      return { border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'N/A':      return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
