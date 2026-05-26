/**
 * Whale Flows — institutional capital movement intelligence (rebuilt).
 *
 * Mirrors the Smart Money 4-layer rebuild (PR #26). The old wallet-
 * transfer feed is preserved as Layer 4 Advanced toggle.
 */
import { loadIntelContext } from '../_components/guard'
import { composeWhaleFlowView, type CapitalMovementSummary,
         type MovementCategoryRow, type SignificantMovement,
         type MovementTableRow, type MovementState, type MovementBias,
         type Aggression, type Persistence, type ConvictionLevel } from '@/lib/whale-flow-engine'
import { cn } from '@/lib/utils'
import WhaleFlowsClient from './WhaleFlowsClient'

export const metadata = { title: 'Whale Flows' }
export const dynamic  = 'force-dynamic'

export default async function WhaleFlowsPage() {
  const { ent } = await loadIntelContext()
  const view = await composeWhaleFlowView({ window: '24h', limit: 150 })

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Whale Flows</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Institutional capital movement intelligence — accumulation vs distribution,
          ecosystem rotation, defensive vs aggressive positioning, cross-chain shifts.
        </p>
      </header>

      <CapitalMovementSummaryPanel summary={view.summary} narrative={view.narrative} />

      {view.categories.length > 0 && (
        <Section title="Capital Movement Categories" blurb="Classified flow types ranked by share of universe flow.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.categories.map((c) => <CategoryCard key={c.category} row={c} />)}
          </div>
        </Section>
      )}

      {view.significant.length > 0 ? (
        <Section title="Significant Movements" blurb="Filtered to institutional minimums; conviction-scored.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {view.significant.map((m) => <SignificantCard key={`${m.chain}-${m.symbol}`} mv={m} />)}
          </div>
        </Section>
      ) : view.partial ? (
        <Notice intent="warn">{view.reason}</Notice>
      ) : (
        <Notice intent="info">No movements currently meet the institutional filters (min liquidity / netflow). Quiet window.</Notice>
      )}

      {view.movement_table.length > 0 && (
        <Section title="Movement Intelligence" blurb="Broader read across the filtered universe.">
          <MovementTable rows={view.movement_table} />
        </Section>
      )}

      <details className="group rounded-2xl border border-border/60 bg-muted/10">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Advanced — Raw Wallet Transfer Feed
          </span>
          <span className="text-[10px] text-muted-foreground group-open:hidden">show</span>
          <span className="hidden text-[10px] text-muted-foreground group-open:inline">hide</span>
        </summary>
        <div className="border-t border-border/60 p-4">
          <WhaleFlowsClient ent={ent} />
        </div>
      </details>
    </main>
  )
}

// ── Reusable shell ───────────────────────────────────────────────────────

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
        <span className="hidden text-[11px] text-muted-foreground sm:block">{blurb}</span>
      </div>
      {children}
    </section>
  )
}

function Notice({ intent, children }: { intent: 'info' | 'warn'; children: React.ReactNode }) {
  const cls = intent === 'warn'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    : 'border-border bg-muted/10 text-muted-foreground'
  return <p className={cn('rounded-xl border px-4 py-3 text-xs', cls)}>{children}</p>
}

// ── Layer 1 — Capital Movement Summary ───────────────────────────────────

function CapitalMovementSummaryPanel({ summary, narrative }: { summary: CapitalMovementSummary; narrative: string }) {
  const biasTone = biasColour(summary.movement_bias)
  return (
    <section className={cn('space-y-4 rounded-2xl border bg-card p-5 shadow-sm', biasTone.border)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Capital Movement Summary</span>
          <p className="text-sm leading-relaxed text-foreground/90 max-w-3xl">{narrative}</p>
        </div>
        <ConvictionDial level={summary.conviction_level} score={summary.confidence} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCell label="Movement Bias"        value={summary.movement_bias}        tone={biasTone.text} />
        <MetricCell label="Dominant Movement"    value={summary.dominant_movement} />
        <MetricCell label="Aggression"           value={summary.movement_aggression}  tone={aggressionColour(summary.movement_aggression)} />
        <MetricCell label="Persistence"          value={summary.capital_persistence}  tone={persistenceColour(summary.capital_persistence)} />
        <MetricCell label="Concentration"        value={`${summary.concentration_pct.toFixed(1)}% in top-5`} />
        <MetricCell label="Active Chains"        value={String(summary.active_chains)} />
        <MetricCell label="Confidence"           value={`${summary.confidence}% · ${summary.conviction_level}`} tone={convictionColour(summary.conviction_level)} />
      </div>
    </section>
  )
}

function MetricCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-sm font-semibold', tone ?? 'text-foreground')}>{value}</div>
    </div>
  )
}

function ConvictionDial({ level, score }: { level: ConvictionLevel; score: number }) {
  const tone = convictionColour(level)
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className={cn('text-3xl font-semibold tabular-nums leading-none', tone)}>{score}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">confidence · {level}</span>
    </div>
  )
}

// ── Layer 2 — Movement Category card ─────────────────────────────────────

function CategoryCard({ row }: { row: MovementCategoryRow }) {
  const tone = movementStateColour(row.category)
  const inflow = row.capital_flow_usd >= 0
  return (
    <div className={cn('rounded-xl border bg-card p-4', tone.border)}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{row.category}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{row.share_of_flow_pct.toFixed(1)}%</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{row.narrative}</p>
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">
          {row.count} {row.count === 1 ? 'token' : 'tokens'}
        </span>
        <span className={cn('font-semibold uppercase tracking-wider', inflow ? 'text-emerald-400' : 'text-rose-400')}>
          Net {inflow ? 'inflow' : 'outflow'}
        </span>
      </div>
      {row.top_tickers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.top_tickers.map((t) => (
            <span key={t} className="font-mono text-[10px] rounded border border-border/60 bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Layer 3 — Significant Movement card ──────────────────────────────────

function SignificantCard({ mv }: { mv: SignificantMovement }) {
  const tone = movementStateColour(mv.movement_state)
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', tone.border)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold tracking-tight">{mv.symbol.replace(/USDT$/, '')}</h3>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{mv.chain} · {mv.sector}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
              {mv.movement_state}
            </span>
            <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              mv.bias === 'Inflow' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border-rose-500/30')}>
              {mv.bias}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={cn('text-xl font-semibold tabular-nums leading-none', convictionColour(mv.conviction_level))}>{mv.conviction}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{mv.conviction_level}</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{mv.narrative}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Cell label="Persistence" value={mv.persistence} tone={persistenceColour(mv.persistence)} />
        <Cell label="Aggression"  value={mv.aggression}  tone={aggressionColour(mv.aggression)} />
      </div>
    </div>
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

// ── Layer 4 — Movement Intelligence Table ────────────────────────────────

function MovementTable({ rows }: { rows: MovementTableRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border/60">
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Token</th>
            <th className="px-4 py-2.5 font-medium">Sector</th>
            <th className="px-4 py-2.5 font-medium">Movement</th>
            <th className="px-4 py-2.5 font-medium">Bias</th>
            <th className="px-4 py-2.5 font-medium">Persistence</th>
            <th className="px-4 py-2.5 font-medium">Scale</th>
            <th className="px-4 py-2.5 text-right font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.chain}-${r.symbol}`} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
              <td className="px-4 py-2.5"><span className="font-mono font-semibold">{r.symbol.replace(/USDT$/, '')}</span></td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.sector}</td>
              <td className="px-4 py-2.5">
                <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', movementStateColour(r.movement_state).pill)}>
                  {r.movement_state}
                </span>
              </td>
              <td className={cn('px-4 py-2.5 text-xs font-semibold', r.bias === 'Inflow' ? 'text-emerald-400' : 'text-rose-400')}>{r.bias}</td>
              <td className={cn('px-4 py-2.5 text-xs font-semibold', persistenceColour(r.persistence))}>{r.persistence}</td>
              <td className="px-4 py-2.5 text-xs">{r.size_scale}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tone helpers ─────────────────────────────────────────────────────────

function biasColour(b: MovementBias): { text: string; border: string } {
  switch (b) {
    case 'Accumulation': return { text: 'text-emerald-400', border: 'border-emerald-500/25' }
    case 'Distribution': return { text: 'text-rose-400',    border: 'border-rose-500/30'    }
    case 'Balanced':     return { text: 'text-sky-400',     border: 'border-sky-500/25'     }
  }
}
function convictionColour(level: ConvictionLevel): string {
  switch (level) {
    case 'Very High': return 'text-emerald-400'
    case 'High':      return 'text-sky-400'
    case 'Moderate':  return 'text-amber-400'
    case 'Weak':      return 'text-muted-foreground'
  }
}
function aggressionColour(a: Aggression): string {
  switch (a) {
    case 'Aggressive': return 'text-rose-400'
    case 'Moderate':   return 'text-amber-400'
    case 'Measured':   return 'text-sky-400'
    case 'Quiet':      return 'text-muted-foreground'
  }
}
function persistenceColour(p: Persistence): string {
  switch (p) {
    case 'Sustained': return 'text-emerald-400'
    case 'Building':  return 'text-sky-400'
    case 'Fading':    return 'text-amber-400'
    case 'Sporadic':  return 'text-muted-foreground'
  }
}
function movementStateColour(s: MovementState): { border: string; pill: string } {
  switch (s) {
    case 'Institutional Accumulation': return { border: 'border-emerald-500/35', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35' }
    case 'Stealth Accumulation':       return { border: 'border-emerald-500/25', pill: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' }
    case 'Ecosystem Rotation':         return { border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Cross-chain Positioning':    return { border: 'border-blue-500/30',    pill: 'bg-blue-500/15 text-blue-400 border-blue-500/30' }
    case 'Aggressive Rotation':        return { border: 'border-violet-500/30',  pill: 'bg-violet-500/15 text-violet-400 border-violet-500/30' }
    case 'Momentum Chasing':           return { border: 'border-blue-500/25',    pill: 'bg-blue-500/15 text-blue-300 border-blue-500/25' }
    case 'Distribution Pressure':      return { border: 'border-rose-500/30',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
    case 'Defensive Capital Movement': return { border: 'border-amber-500/25',   pill: 'bg-amber-500/10 text-amber-300 border-amber-500/25' }
    case 'Speculative Risk':           return { border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Capital Fragmentation':      return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
    case 'Flat':                       return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
