/**
 * Intelligence Hub overview — the shared parent surface for the 4 V3
 * sidebar hubs (Capital Flows, Market Sentiment, Market Structure,
 * Momentum). Each hub picks its own moduleKeys + deep-link rail;
 * everything else is rendered identically here so the IA feels
 * institutional and consistent ([[market_intel_v3_spec]]).
 *
 * What this surface guarantees:
 *
 *   - Verdict tiles (Coverage / Reliability / Data Quality / Freshness)
 *     match Phase 5 of the V3 spec — same vocabulary on every hub.
 *   - Engine cards render the sanitized `reasoning` only — NEVER the raw
 *     `insight` field (which still flows through for admin telemetry).
 *   - Deep-link rail at the bottom takes the user to the specialist page
 *     for any individual engine without leaving the hub mental model.
 *
 * Server component — receives a pre-fetched GridPayload so each page
 * only does one composer call.
 */
import Link from 'next/link'
import {
  ArrowRight, Activity, CheckCircle2, Clock, Database, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GridPayload, IntelligenceModule, GridVerdict } from '@/lib/intelligence/grid-types'

export interface HubSpec {
  title:       string
  subtitle:    string
  icon:        LucideIcon
  /** Decision-Brain module keys this hub renders, in display order. */
  moduleKeys:  string[]
  /** Specialist pages users can dive into without leaving the hub IA. */
  deepLinks:   Array<{ label: string; href: string; blurb: string }>
}

export default function HubOverview({ spec, payload }: { spec: HubSpec; payload: GridPayload }) {
  const Icon = spec.icon
  const verdict  = payload.verdict
  const modules  = spec.moduleKeys
    .map((k) => payload.modules.find((m) => m.key === k))
    .filter((m): m is IntelligenceModule => !!m)

  // Hub-local coverage / reliability — scoped to the engines on THIS
  // page. The system-wide verdict still flavors the header but the
  // tiles below report what the user can actually see right here.
  const localCoverage    = pct(modules.filter((m) => m.userStatus === 'live' || m.userStatus === 'degraded').length, modules.length || 1)
  const localReliability = pct(modules.filter((m) => m.source_quality === 'high' || m.source_quality === 'medium').length, modules.length || 1)
  const localDataQuality: GridVerdict['data_quality'] =
    localReliability >= 70 ? 'high'
    : localReliability >= 40 ? 'medium'
    :                          'low'
  const freshness = newestFreshness(modules)

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Icon className="h-5 w-5 text-amber-300" strokeWidth={1.75} aria-hidden />
          {spec.title}
        </h1>
        <p className="text-xs text-muted-foreground max-w-3xl">{spec.subtitle}</p>
      </header>

      {/* V3 Phase 5 vocabulary — same shape on every hub. */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <header className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Hub Verdict
          </h2>
          <span className="ml-auto text-[10px] text-muted-foreground">
            scoped to {modules.length} engine{modules.length === 1 ? '' : 's'}
          </span>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Coverage"     value={`${localCoverage}%`}    tone={localCoverage >= 70 ? 'emerald' : localCoverage >= 40 ? 'amber' : 'rose'} icon={CheckCircle2} />
          <Tile label="Reliability"  value={`${localReliability}%`} tone={localReliability >= 70 ? 'emerald' : localReliability >= 40 ? 'amber' : 'rose'} icon={CheckCircle2} />
          <Tile label="Data Quality" value={cap(localDataQuality)}  tone={localDataQuality === 'high' ? 'emerald' : localDataQuality === 'medium' ? 'amber' : 'rose'} icon={Database} />
          <Tile label="Freshness"    value={freshness}              tone="amber" icon={Clock} />
        </div>
        {verdict.explanation[0] && (
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground/80">System read:</span>{' '}
            {verdict.explanation[0]}
          </p>
        )}
      </section>

      {/* Per-engine cards — sanitized reasoning only. */}
      {modules.length > 0 ? (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {modules.map((m) => <EngineCard key={m.key} m={m} />)}
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground">
          Engines for this hub are recalibrating — read resumes on the next cycle.
        </div>
      )}

      {/* Deep-dive rail. */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Specialist views
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {spec.deepLinks.map((l) => (
            <Link key={l.href} href={l.href}
                  className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.04]">
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{l.label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{l.blurb}</p>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-amber-300" strokeWidth={2} aria-hidden />
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}


function EngineCard({ m }: { m: IntelligenceModule }) {
  const tone =
    m.status === 'bullish' ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
    : m.status === 'bearish' ? 'border-rose-500/30 bg-rose-500/[0.04]'
    : m.status === 'neutral' ? 'border-sky-500/25 bg-sky-500/[0.03]'
    :                          'border-border bg-muted/[0.04]'
  const statusLabel =
    m.userStatus === 'live'     ? { label: 'Live',     cls: 'text-emerald-300' }
    : m.userStatus === 'degraded' ? { label: 'Degraded', cls: 'text-amber-300' }
    : m.userStatus === 'stale'   ? { label: 'Cached',   cls: 'text-amber-300' }
    : m.userStatus === 'fallback' ? { label: 'Internal model', cls: 'text-cyan-300' }
    :                               { label: 'Building', cls: 'text-muted-foreground' }
  const sourceLabel =
    m.source_quality === 'high'     ? 'Source · High'
    : m.source_quality === 'medium' ? 'Source · Medium'
    : m.source_quality === 'low'    ? 'Source · Low'
    :                                 'Source · Internal'
  return (
    <article className={cn('rounded-xl border bg-card p-4 shadow-sm', tone)}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{m.name}</h3>
          <span className={cn('mt-1 inline-block text-[10px] font-bold uppercase tracking-wider', statusLabel.cls)}>
            {statusLabel.label}
          </span>
        </div>
        {m.directional && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-xl font-semibold tabular-nums leading-none">
              {Math.round(m.confidence)}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">confidence</span>
          </div>
        )}
      </header>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{m.reasoning}</p>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        <span>{sourceLabel}</span>
        <span>{m.freshness}</span>
      </footer>
    </article>
  )
}


function Tile({ label, value, tone, icon: Icon }: {
  label: string
  value: string
  tone:  'emerald' | 'amber' | 'rose'
  icon:  LucideIcon
}) {
  const cls = { emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' }[tone]
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
        {label}
      </div>
      <div className={cn('mt-0.5 text-xl font-bold tabular-nums leading-none', cls)}>
        {value}
      </div>
    </div>
  )
}


function pct(n: number, d: number): number {
  if (d <= 0) return 0
  return Math.round((n / d) * 100)
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Newest freshness across the hub's modules — picks the most recent
 *  human-readable label so the verdict tile reflects the active read. */
function newestFreshness(modules: IntelligenceModule[]): string {
  if (modules.length === 0) return '—'
  // Modules carry `updatedAt` ISO; pick the freshest.
  const newest = modules.reduce((a, b) =>
    new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime() ? a : b,
  )
  return newest.freshness
}
