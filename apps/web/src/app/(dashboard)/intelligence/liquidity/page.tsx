/**
 * Liquidity Intelligence — institutional order-book structure.
 *
 * Per the brief Section 2: imbalance, resting-liquidity walls, voids,
 * thin-liquidity detection, sweep risk, execution stability, manipulation
 * risk. Sourced from live Coinbase L2 order books. Exposes institutional
 * STATES — never raw level-by-level book data.
 */
import { loadIntelContext } from '../_components/guard'
import { composeLiquidityBoard, type AssetLiquidityView, type ExecutionCondition,
         type SpreadCondition, type DepthCondition, type ImbalanceState,
         type SweepRisk, type ManipulationRisk, type LiquidityZone } from '@/lib/liquidity-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Liquidity Intelligence' }
export const dynamic  = 'force-dynamic'

export default async function LiquidityPage() {
  await loadIntelContext()
  const board = await composeLiquidityBoard()
  const sorted = board.views.sort((a, b) => b.quality_score - a.quality_score)

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Liquidity Intelligence</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Order-book structure across the crypto majors — execution conditions,
          imbalance, resting-liquidity walls, voids, and sweep risk. Live via
          Coinbase L2. Equities / FX order-book intelligence needs separate feeds.
        </p>
      </header>

      <SummaryStrip summary={board.summary} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((v) => <LiquidityCard key={v.symbol} view={v} />)}
      </div>

      {board.partial && (
        <p className="text-xs text-amber-400">
          Some books showed as unavailable — Coinbase responded partially.
          Quality ranking excludes them; refresh in a few seconds.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Note: this is a live book <em>snapshot</em> analysis. Absorption (which needs a
        time series) and exact forced-liquidation prices are deliberately not shown —
        positioning / liquidation pressure lives in the Positioning engine instead.
      </p>
    </main>
  )
}

function SummaryStrip({ summary }: { summary: { favorable: number; sweep_risk: number; narrative: string } }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Execution Landscape</span>
        <span className="text-sm font-semibold text-foreground/90">{summary.narrative}</span>
      </div>
      <div className="ml-auto flex shrink-0 gap-4">
        <div className="flex flex-col items-end">
          <span className="text-lg font-semibold tabular-nums leading-none text-emerald-400">{summary.favorable}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">favorable</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-lg font-semibold tabular-nums leading-none text-rose-400">{summary.sweep_risk}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">sweep risk</span>
        </div>
      </div>
    </section>
  )
}

function LiquidityCard({ view }: { view: AssetLiquidityView }) {
  const tone = execTone(view.execution_condition)
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-sm', tone.border)}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{view.symbol.replace(/USDT$/, '')}</h2>
          <span className={cn('mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone.pill)}>
            {view.execution_condition}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={cn('text-xl font-semibold tabular-nums leading-none', tone.text)}>{view.quality_score}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">quality</span>
        </div>
      </header>

      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{view.narrative}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Cell label="Spread"        value={view.spread_condition} tone={spreadTone(view.spread_condition)} />
        <Cell label="Depth"         value={view.depth_condition}  tone={depthTone(view.depth_condition)} />
        <Cell label="Imbalance"     value={view.imbalance === 'N/A' ? 'N/A' : `${view.imbalance} ${view.imbalance_pct}%`} tone={imbalanceTone(view.imbalance)} />
        <Cell label="Sweep Risk"    value={view.sweep_risk}       tone={riskTone(view.sweep_risk)} />
      </div>

      {(view.walls.length > 0 || view.voids.length > 0) && (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2">
          {view.walls.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Walls</span>
              {view.walls.map((w, i) => <ZoneTag key={`w${i}`} zone={w} kind="wall" />)}
            </div>
          )}
          {view.voids.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Voids</span>
              {view.voids.map((v, i) => <ZoneTag key={`v${i}`} zone={v} kind="void" />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ZoneTag({ zone, kind }: { zone: LiquidityZone; kind: 'wall' | 'void' }) {
  const above = zone.distance_pct >= 0
  const cls = kind === 'wall'
    ? (zone.side === 'bid' ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300')
    : 'border-amber-500/30 text-amber-300'
  const scaleTag = kind === 'wall' ? `${zone.scale} ` : ''
  return (
    <span className={cn('rounded border bg-muted/20 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums', cls)}>
      {scaleTag}{above ? '+' : ''}{zone.distance_pct.toFixed(2)}%
    </span>
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

function execTone(e: ExecutionCondition): { text: string; border: string; pill: string } {
  switch (e) {
    case 'Favorable':           return { text: 'text-emerald-400', border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Imbalanced':          return { text: 'text-amber-400',   border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Thin Liquidity':      return { text: 'text-amber-400',   border: 'border-amber-500/30',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    case 'Sweep Risk Elevated': return { text: 'text-rose-400',    border: 'border-rose-500/35',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/35' }
    case 'Unstable':            return { text: 'text-rose-400',    border: 'border-rose-500/35',    pill: 'bg-rose-500/15 text-rose-400 border-rose-500/35' }
    case 'Unknown':             return { text: 'text-muted-foreground', border: 'border-border',    pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
function spreadTone(s: SpreadCondition): string {
  return s === 'Tight' ? 'text-emerald-400' : s === 'Normal' ? 'text-sky-400' : s === 'Wide' ? 'text-rose-400' : 'text-muted-foreground'
}
function depthTone(d: DepthCondition): string {
  return d === 'Deep' ? 'text-emerald-400' : d === 'Adequate' ? 'text-sky-400' : d === 'Thin' ? 'text-rose-400' : 'text-muted-foreground'
}
function imbalanceTone(i: ImbalanceState): string {
  return i === 'Bid-Heavy' ? 'text-emerald-400' : i === 'Ask-Heavy' ? 'text-rose-400' : i === 'Balanced' ? 'text-sky-400' : 'text-muted-foreground'
}
function riskTone(r: SweepRisk | ManipulationRisk): string {
  return r === 'Low' ? 'text-emerald-400' : r === 'Moderate' ? 'text-amber-400' : r === 'Elevated' ? 'text-rose-400' : 'text-muted-foreground'
}
