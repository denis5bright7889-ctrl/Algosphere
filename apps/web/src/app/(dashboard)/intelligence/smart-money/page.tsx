/**
 * Smart Money — institutional capital-flow intelligence (rebuilt).
 *
 * Replaces the previous wallet-feed dashboard with a 4-layer
 * Bloomberg-style intelligence view:
 *
 *   Layer 1  Market Flow Summary       — 8 universe-level metrics + AI narrative
 *   Layer 2  Sector & Narrative Rotation — capital flow by sector with direction / acceleration
 *   Layer 3  High Conviction Flows     — filtered, fused with Momentum
 *   Layer 4  Flow Intelligence Table   — secondary, improved columns
 *
 * The old SmartMoneyClient (per-row wallet table) is preserved as an
 * Advanced Raw Wallet Feed toggle at the bottom — accessible but no
 * longer the default surface.
 */
import { loadIntelContext } from '../_components/guard'
import { composeSmartMoneyFlow, type MarketFlowSummary, type SectorRotationRow,
         type HighConvictionFlow, type FlowIntelligenceRow, type FlowState,
         type ConvictionLevel, type SmartMoneyBias, type RiskAppetite,
         type FlowSustainability, type ParticipationQuality, type WalletTier } from '@/lib/smart-money-engine'
import { cn } from '@/lib/utils'
import SmartMoneyClient from './SmartMoneyClient'

export const metadata = { title: 'Smart Money' }
export const dynamic  = 'force-dynamic'

export default async function SmartMoneyPage() {
  const { ent } = await loadIntelContext()
  const view = await composeSmartMoneyFlow({ window: '24h', limit: 120 })

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Smart Money</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Institutional capital-flow intelligence — where intelligent capital
          is moving, how sustainable participation is, and where asymmetric
          opportunity is forming.
        </p>
      </header>

      {/* ── LAYER 1 — Market Flow Summary ───────────────────────────────── */}
      <MarketFlowSummaryPanel
        summary={view.summary}
        narrative={view.narrative}
        fromHeuristic={view.fromHeuristic ?? false}
      />

      {/* ── LAYER 2 — Sector & Narrative Rotation ────────────────────────── */}
      {view.sectors.length > 0 && (
        <Section title="Sector & Narrative Rotation"
                 blurb="Where capital is moving across institutional sector buckets.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.sectors.map((s) => <SectorRotationCard key={s.sector} row={s} />)}
          </div>
        </Section>
      )}

      {/* ── LAYER 3 — High Conviction Flows ──────────────────────────────── */}
      {view.high_conviction.length > 0 ? (
        <Section title="High Conviction Flows"
                 blurb="Filtered to institutional minimums (liquidity / sustainability / participation) and fused with Momentum.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {view.high_conviction.map((f) => <HighConvictionCard key={`${f.chain}-${f.symbol}`} flow={f} />)}
          </div>
        </Section>
      ) : view.partial ? (
        <Notice intent="info">
          High-conviction wallet-level reads are recalibrating. The Market Flow
          Summary above is being carried by the internal cross-engine model —
          per-wallet flows resume once the primary source returns.
        </Notice>
      ) : (
        <Notice intent="info">No flows currently meet the institutional filters (min liquidity / volume / netflow). Quiet window — check back in a few minutes.</Notice>
      )}

      {/* ── LAYER 4 — Flow Intelligence Table ────────────────────────────── */}
      {view.flow_table.length > 0 && (
        <Section title="Flow Intelligence" blurb="Broader read across the filtered universe.">
          <FlowTable rows={view.flow_table} />
        </Section>
      )}

      {/* ── Advanced — raw wallet feed (legacy client, deliberately last) ── */}
      <details className="group rounded-2xl border border-border/60 bg-muted/10">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Advanced — Raw Wallet Feed
          </span>
          <span className="text-[10px] text-muted-foreground group-open:hidden">show</span>
          <span className="hidden text-[10px] text-muted-foreground group-open:inline">hide</span>
        </summary>
        <div className="border-t border-border/60 p-4">
          <SmartMoneyClient ent={ent} />
        </div>
      </details>
    </main>
  )
}

// ── Reusable section wrapper ─────────────────────────────────────────────

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

// ── Layer 1 — Market Flow Summary panel ──────────────────────────────────

function MarketFlowSummaryPanel({ summary, narrative, fromHeuristic }: {
  summary:       MarketFlowSummary
  narrative:     string
  fromHeuristic: boolean
}) {
  const biasTone = biasColour(summary.smart_money_bias)
  return (
    <section className={cn('space-y-4 rounded-2xl border bg-card p-5 shadow-sm', biasTone.border)}>
      {/* Top strip — institutional narrative + composite conviction */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Market Flow Summary</span>
            {fromHeuristic && (
              <span
                title="Primary provider unavailable this cycle. Read is composed from regime + breadth + dominance cross-engine consensus. Source quality intentionally capped."
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cyan-300"
              >
                Internal model
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-foreground/90 max-w-3xl">{narrative}</p>
        </div>
        <ConvictionDial level={summary.conviction_level} score={summary.conviction} />
      </div>

      {/* 8-cell metrics grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCell label="Smart Money Bias"      value={summary.smart_money_bias}     tone={biasTone.text} />
        <MetricCell label="Dominant Rotation"     value={summary.dominant_rotation} />
        <MetricCell label="Capital Concentration" value={summary.capital_concentration} />
        <MetricCell label="Participation Quality" value={summary.participation_quality} tone={qualityColour(summary.participation_quality)} />
        <MetricCell label="Risk Appetite"         value={summary.risk_appetite}        tone={riskColour(summary.risk_appetite)} />
        <MetricCell label="Conviction"            value={`${summary.conviction}% · ${summary.conviction_level}`} tone={convictionColour(summary.conviction_level)} />
        <MetricCell label="Flow Sustainability"   value={summary.flow_sustainability}  tone={sustainColour(summary.flow_sustainability)} />
        <MetricCell label="Market Aggression"     value={`${summary.market_aggression}%`} />
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
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">conviction · {level}</span>
    </div>
  )
}

// ── Layer 2 — Sector Rotation card ───────────────────────────────────────

function SectorRotationCard({ row }: { row: SectorRotationRow }) {
  const tone = directionColour(row.direction)
  return (
    <div className={cn('rounded-xl border bg-card p-4', tone.border)}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{row.sector}</h3>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
            {row.direction}
          </span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{row.share_of_flow_pct.toFixed(1)}%</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{row.narrative}</p>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span><span className="uppercase tracking-wider">Acceleration:</span> <span className="font-semibold text-foreground/80">{row.acceleration}</span></span>
        <span><span className="uppercase tracking-wider">Participation:</span> <span className="font-semibold text-foreground/80">{row.participation_quality}</span></span>
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

// ── Layer 3 — High Conviction Flow card ──────────────────────────────────

function HighConvictionCard({ flow }: { flow: HighConvictionFlow }) {
  const tone = flowStateColour(flow.flow_state)
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', tone.border, flow.fusion_aligned && 'ring-1 ring-emerald-500/20')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold tracking-tight">{flow.symbol.replace(/USDT$/, '')}</h3>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{flow.chain} · {flow.sector}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
              {flow.flow_state}
            </span>
            {flow.momentum_phase !== 'Unknown' && (
              <span className="rounded-md border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Momentum: {flow.momentum_phase}
              </span>
            )}
            {flow.fusion_aligned && (
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                Aligned
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={cn('text-xl font-semibold tabular-nums leading-none', convictionColour(flow.conviction_level))}>
            {flow.confidence}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{flow.conviction_level}</span>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{flow.narrative}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <Cell label="SM Quality"    value={`${flow.smart_money_quality}`} />
        <Cell label="Participation" value={flow.participation_quality} tone={qualityColour(flow.participation_quality)} />
        <Cell label="Wallet Tier"   value={flow.wallet_tier}            tone={walletTierColour(flow.wallet_tier)} />
        <Cell label="Risk"          value={flow.risk_label}              tone={riskLabelColour(flow.risk_label)} />
      </div>
    </div>
  )
}

function walletTierColour(t: WalletTier): string {
  switch (t) {
    case 'Institutional':    return 'text-emerald-400'
    case 'Smart Capital':    return 'text-sky-400'
    case 'Ecosystem Wallet': return 'text-blue-400'
    case 'Momentum Capital': return 'text-violet-400'
    case 'Retail Whale':     return 'text-amber-400'
    case 'Speculative':      return 'text-rose-400'
    case 'Unclassified':     return 'text-muted-foreground'
  }
}

function Cell({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-xs font-semibold tabular-nums', tone ?? 'text-foreground')}>{value}</div>
    </div>
  )
}

// ── Layer 4 — Flow Intelligence Table ────────────────────────────────────

function FlowTable({ rows }: { rows: FlowIntelligenceRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border/60">
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Token</th>
            <th className="px-4 py-2.5 font-medium">Sector</th>
            <th className="px-4 py-2.5 font-medium">Flow State</th>
            <th className="px-4 py-2.5 font-medium">Smart Money</th>
            <th className="px-4 py-2.5 font-medium">Sustainability</th>
            <th className="px-4 py-2.5 font-medium">Rotation</th>
            <th className="px-4 py-2.5 text-right font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.chain}-${r.symbol}`} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
              <td className="px-4 py-2.5"><span className="font-mono font-semibold">{r.symbol.replace(/USDT$/, '')}</span></td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.sector}</td>
              <td className="px-4 py-2.5">
                <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', flowStateColour(r.flow_state).pill)}>
                  {r.flow_state}
                </span>
              </td>
              <td className="px-4 py-2.5 tabular-nums">{r.smart_money_quality}</td>
              <td className={cn('px-4 py-2.5 text-xs font-semibold', sustainColour(r.sustainability))}>{r.sustainability}</td>
              <td className={cn('px-4 py-2.5 text-xs font-semibold', rotationColour(r.rotation_alignment))}>{r.rotation_alignment}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tone helpers (all concentrated here for consistency) ────────────────

function biasColour(b: SmartMoneyBias): { text: string; border: string } {
  switch (b) {
    case 'Bullish': return { text: 'text-emerald-400', border: 'border-emerald-500/25' }
    case 'Bearish': return { text: 'text-rose-400',    border: 'border-rose-500/30'    }
    case 'Neutral': return { text: 'text-sky-400',     border: 'border-sky-500/25'     }
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
function qualityColour(q: ParticipationQuality): string {
  switch (q) {
    case 'Strong':   return 'text-emerald-400'
    case 'Moderate': return 'text-sky-400'
    case 'Weak':     return 'text-amber-400'
    case 'N/A':      return 'text-muted-foreground'
  }
}
function riskColour(r: RiskAppetite): string {
  switch (r) {
    case 'Aggressive': return 'text-rose-400'
    case 'Elevated':   return 'text-amber-400'
    case 'Measured':   return 'text-sky-400'
    case 'Defensive':  return 'text-emerald-400/70'
  }
}
function sustainColour(s: FlowSustainability): string {
  switch (s) {
    case 'High':       return 'text-emerald-400'
    case 'Moderate':   return 'text-sky-400'
    case 'Fragile':    return 'text-amber-400'
    case 'Weakening':  return 'text-rose-400'
  }
}
function riskLabelColour(r: HighConvictionFlow['risk_label']): string {
  switch (r) {
    case 'Low':       return 'text-emerald-400'
    case 'Moderate':  return 'text-sky-400'
    case 'Elevated':  return 'text-amber-400'
    case 'High':      return 'text-rose-400'
  }
}
function rotationColour(a: FlowIntelligenceRow['rotation_alignment']): string {
  switch (a) {
    case 'Aligned': return 'text-emerald-400'
    case 'Mixed':   return 'text-amber-400'
    case 'Counter': return 'text-rose-400'
  }
}
function directionColour(d: SectorRotationRow['direction']): { border: string; pill: string } {
  switch (d) {
    case 'Strong Inflows': return { border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Inflows':        return { border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Outflows':       return { border: 'border-rose-500/30',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
    case 'Weakening':      return { border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Flat':           return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
function flowStateColour(s: FlowState): { border: string; pill: string } {
  switch (s) {
    case 'Institutional Build-Up': return { border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Accumulation':           return { border: 'border-sky-500/30',     pill: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
    case 'Expansion':              return { border: 'border-blue-500/30',    pill: 'bg-blue-500/15 text-blue-400 border-blue-500/30' }
    case 'Aggressive Rotation':    return { border: 'border-violet-500/30',  pill: 'bg-violet-500/15 text-violet-400 border-violet-500/30' }
    case 'Speculative Spike':      return { border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Distribution':           return { border: 'border-rose-500/30',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
    case 'Exhaustion':             return { border: 'border-amber-600/30',   pill: 'bg-amber-600/15 text-amber-300 border-amber-600/30' }
    case 'Collapse Risk':          return { border: 'border-rose-500/40',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/40' }
    case 'Weak Participation':     return { border: 'border-border',         pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
