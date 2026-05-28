/**
 * Narrative Intelligence — institutional theme tracker.
 *
 * Per the brief (Section 7): tracks ecosystem narratives, AI themes,
 * meme speculation, ETF / macro / stablecoin narratives, sector
 * rotations. Each theme exposes strength / acceleration / fatigue /
 * institutional participation / crowding.
 */
import { loadIntelContext } from '../_components/guard'
import { composeNarrativeBoard, type NarrativeView, type NarrativeStrength,
         type NarrativeAcceleration, type NarrativeFatigue,
         type InstitutionalParticipation, type CrowdingRisk } from '@/lib/narrative-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Narrative Intelligence' }
export const dynamic  = 'force-dynamic'

export default async function NarrativeIntelligencePage() {
  await loadIntelContext()
  const board = await composeNarrativeBoard({ window: '24h' })

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Narrative Intelligence</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Which themes are gathering attention, which are fading, where is the crowd,
          and where is institutional capital actually validating the story.
        </p>
      </header>

      <HeadlinePanel headline={board.headline}
                     dominant={board.dominant_theme}
                     accelerating={board.accelerating_theme}
                     exhausting={board.exhausting_theme} />

      {board.themes.length === 0 ? (
        <p className={cn('rounded-xl border px-4 py-3 text-xs',
          board.partial ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        : 'border-border bg-muted/10 text-muted-foreground')}>
          {board.reason ?? 'No themes available for this window.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {board.themes.map((t) => <ThemeCard key={t.theme} theme={t} />)}
        </div>
      )}
    </main>
  )
}

// ── Top headline panel ───────────────────────────────────────────────────

function HeadlinePanel({ headline, dominant, accelerating, exhausting }: {
  headline: string; dominant: string; accelerating: string | null; exhausting: string | null
}) {
  return (
    <section className="rounded-2xl border border-violet-500/25 bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Narrative Landscape</span>
          <p className="text-sm leading-relaxed text-foreground/90 max-w-3xl">{headline}</p>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2 text-[10px] sm:grid-cols-1">
          <HeadCell label="Dominant"      value={dominant}             tone="text-emerald-400" />
          <HeadCell label="Accelerating"  value={accelerating ?? '—'}  tone="text-sky-400" />
          <HeadCell label="Exhausting"    value={exhausting   ?? '—'}  tone="text-amber-400" />
        </div>
      </div>
    </section>
  )
}

function HeadCell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-xs font-semibold', tone)}>{value}</div>
    </div>
  )
}

// ── Theme card ───────────────────────────────────────────────────────────

function ThemeCard({ theme }: { theme: NarrativeView }) {
  const tone = strengthTone(theme.strength)
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-sm', tone.border)}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{theme.theme}</h2>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
            {theme.strength}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={cn('text-2xl font-semibold tabular-nums leading-none', tone.text)}>{theme.strength_score}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">strength</span>
        </div>
      </header>

      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{theme.narrative}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Cell label="Acceleration"    value={theme.acceleration}              tone={accelerationTone(theme.acceleration)} />
        <Cell label="Fatigue"         value={theme.fatigue}                   tone={fatigueTone(theme.fatigue)} />
        <Cell label="Institutional"   value={theme.institutional_participation} tone={participationTone(theme.institutional_participation)} />
        <Cell label="Crowding"        value={theme.crowding}                  tone={crowdingTone(theme.crowding)} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/50 pt-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Share of flow: <span className="text-foreground/80 tabular-nums">{theme.share_of_flow_pct.toFixed(1)}%</span>
        </span>
        {theme.top_tickers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {theme.top_tickers.map((t) => (
              <span key={t} className="font-mono text-[10px] rounded border border-border/60 bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-xs font-semibold', tone ?? 'text-foreground')}>{value}</div>
    </div>
  )
}

// ── Tones ────────────────────────────────────────────────────────────────

function strengthTone(s: NarrativeStrength): { text: string; border: string; pill: string } {
  switch (s) {
    case 'Dominant': return { text: 'text-emerald-400', border: 'border-emerald-500/35', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35' }
    case 'Strong':   return { text: 'text-sky-400',     border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Building': return { text: 'text-blue-400',    border: 'border-blue-500/25',    pill: 'bg-blue-500/15 text-blue-400 border-blue-500/25' }
    case 'Quiet':    return { text: 'text-muted-foreground', border: 'border-border',    pill: 'bg-muted/20 text-muted-foreground border-border' }
    case 'N/A':      return { text: 'text-muted-foreground', border: 'border-border',    pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
function accelerationTone(a: NarrativeAcceleration): string {
  switch (a) {
    case 'Accelerating': return 'text-emerald-400'
    case 'Steady':       return 'text-sky-400'
    case 'Decelerating': return 'text-amber-400'
    case 'Fading':       return 'text-rose-400'
    case 'N/A':          return 'text-muted-foreground'
  }
}
function fatigueTone(f: NarrativeFatigue): string {
  switch (f) {
    case 'Fresh':     return 'text-emerald-400'
    case 'Healthy':   return 'text-sky-400'
    case 'Stretched': return 'text-amber-400'
    case 'Exhausted': return 'text-rose-400'
    case 'N/A':       return 'text-muted-foreground'
  }
}
function participationTone(p: InstitutionalParticipation): string {
  switch (p) {
    case 'Heavy':  return 'text-emerald-400'
    case 'Active': return 'text-sky-400'
    case 'Light':  return 'text-amber-400'
    case 'Absent': return 'text-rose-400'
    case 'N/A':    return 'text-muted-foreground'
  }
}
function crowdingTone(c: CrowdingRisk): string {
  switch (c) {
    case 'Crowded':  return 'text-rose-400'
    case 'Active':   return 'text-amber-400'
    case 'Balanced': return 'text-emerald-400'
    case 'Quiet':    return 'text-muted-foreground'
    case 'N/A':      return 'text-muted-foreground'
  }
}
