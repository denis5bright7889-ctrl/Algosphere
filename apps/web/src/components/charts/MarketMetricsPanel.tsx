'use client'

/**
 * Market structure metrics for the chart modal — the engine's read of
 * momentum, trend strength, and structure quality. Liquidity condition
 * has no per-symbol feed yet, so it links out to the Liquidity dashboard
 * rather than showing a fabricated value.
 */
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { SkeletonText } from '@/components/ui/Skeleton'
import type { SymbolIntel } from '@/lib/chart-intel'

export default function MarketMetricsPanel({
  intel, loading,
}: {
  intel: SymbolIntel | null
  loading: boolean
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-3.5">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Market Structure</h3>
      {loading ? (
        <SkeletonText lines={4} />
      ) : !intel || !intel.available ? (
        <p className="text-xs text-muted-foreground">Awaiting engine scan.</p>
      ) : (
        <div className="space-y-1">
          <Row label="Trend Strength" value={intel.trend_strength ?? '—'}
               tone={intel.trend_strength === 'Strong' ? 'text-emerald-400' : intel.trend_strength === 'Weak' ? 'text-muted-foreground' : ''} />
          <Row label="Momentum" value={intel.momentum ?? '—'}
               tone={intel.momentum === 'Strong' ? 'text-emerald-400' : intel.momentum === 'Weak' ? 'text-muted-foreground' : ''} />
          <Row label="Structure Quality" value={intel.structure ?? '—'}
               tone={intel.structure === 'Choppy' || intel.structure === 'Unclear Structure' ? 'text-amber-400' : 'text-emerald-400'} />
          <Row label="Volatility" value={intel.volatility ?? '—'}
               tone={intel.volatility === 'High' ? 'text-rose-400' : intel.volatility === 'Elevated' ? 'text-amber-400' : ''} />
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">Liquidity Condition</span>
            <Link href="/intelligence/liquidity" className="text-[11px] font-semibold text-amber-300/80 hover:text-amber-300">
              View →
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}

function Row({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-semibold', tone)}>{value}</span>
    </div>
  )
}
