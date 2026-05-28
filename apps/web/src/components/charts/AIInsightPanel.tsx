'use client'

/**
 * AI insight rail for the chart modal.
 *
 * Renders the institutional read derived from the engine's real regime
 * snapshot: a Regime Summary, an AI Confidence block (confidence /
 * directional bias / risk / volatility scores), and a Macro Overlay of
 * honest link-out placeholders (whale activity, funding, dominance,
 * sentiment, liquidity heat) into the dedicated dashboards. Everything is
 * derived from real data or clearly marked as a cross-surface link — no
 * fabricated numbers.
 */
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { SkeletonText } from '@/components/ui/Skeleton'
import { stateTone, type MarketState } from '@/lib/market-language'
import type { SymbolIntel } from '@/lib/chart-intel'

type Bias = 'Bullish' | 'Bearish' | 'Neutral'

function biasFromState(state: MarketState | null): Bias {
  switch (state) {
    case 'Trending Up': case 'Accumulation': case 'Breakout Setup': return 'Bullish'
    case 'Trending Down': case 'Distribution': case 'Reversal Risk':  return 'Bearish'
    default: return 'Neutral'
  }
}

// Derived 0–100 helpers (clearly labelled "derived" in the UI).
function volScore(v: SymbolIntel['volatility']): number {
  return v === 'High' ? 88 : v === 'Elevated' ? 64 : v === 'Normal' ? 38 : 16
}
function riskScore(intel: SymbolIntel): number {
  let r = volScore(intel.volatility)
  if (intel.structure === 'Choppy') r = Math.min(100, r + 12)
  if (intel.structure === 'Unclear Structure') r = Math.min(100, r + 8)
  return r
}

export default function AIInsightPanel({
  intel, loading,
}: {
  intel: SymbolIntel | null
  loading: boolean
}) {
  if (loading) {
    return (
      <Section title="AI Intelligence">
        <SkeletonText lines={5} />
      </Section>
    )
  }
  if (!intel || !intel.available) {
    return (
      <Section title="AI Intelligence">
        <p className="text-xs text-muted-foreground">
          {intel?.reason ?? 'No regime read on record for this instrument yet. The engine populates this once it scans the symbol.'}
        </p>
      </Section>
    )
  }

  const bias = biasFromState(intel.state)
  const biasTone = bias === 'Bullish' ? 'text-emerald-400' : bias === 'Bearish' ? 'text-rose-400' : 'text-muted-foreground'

  return (
    <div className="space-y-4">
      {/* Regime summary */}
      <Section title="Regime Summary">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-semibold', stateTone(intel.state ?? 'Mixed Conditions'))}>
            {intel.state}
          </span>
          {intel.stale && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
              Delayed · {intel.age_label}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Engine read on the <span className="font-semibold text-foreground/80">{intel.engine_timeframe}</span> timeframe
          {intel.age_label && !intel.stale ? ` · ${intel.age_label}` : ''}.
        </p>
      </Section>

      {/* AI confidence block */}
      <Section title="AI Confidence">
        <ScoreRow label="Confidence"  value={intel.confidence ?? 0} tone="amber" />
        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-muted-foreground">Directional Bias</span>
          <span className={cn('text-xs font-semibold', biasTone)}>{bias}</span>
        </div>
        <ScoreRow label="Risk"        value={riskScore(intel)} tone="rose"  derived />
        <ScoreRow label="Volatility"  value={volScore(intel.volatility)} tone="sky" derived />
      </Section>

      {/* Macro overlay — honest link-outs, not fabricated numbers */}
      <Section title="Macro Overlay">
        <div className="grid grid-cols-2 gap-2">
          <MacroCard label="Whale Activity"  href="/intelligence/whale-flows" />
          <MacroCard label="Funding / OI"    href="/intelligence/positioning" />
          <MacroCard label="Dominance"       href="/intelligence/market-pulse" />
          <MacroCard label="Sentiment"       href="/intelligence/attention" />
          <MacroCard label="Liquidity Heat"  href="/intelligence/liquidity" />
          <MacroCard label="Smart Money"     href="/intelligence/smart-money" />
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-3.5">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function ScoreRow({ label, value, tone, derived }: { label: string; value: number; tone: 'amber' | 'rose' | 'sky'; derived?: boolean }) {
  const bar = tone === 'rose' ? 'bg-rose-400' : tone === 'sky' ? 'bg-sky-400' : 'bg-amber-400'
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {label}{derived && <span className="ml-1 text-[9px] uppercase tracking-wider text-muted-foreground/50">derived</span>}
        </span>
        <span className="text-xs font-semibold tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/30">
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div className={cn('h-full transition-all', bar)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

function MacroCard({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 transition-colors hover:border-amber-500/40"
    >
      <span className="block text-[11px] font-semibold group-hover:text-amber-300">{label}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">View →</span>
    </Link>
  )
}
