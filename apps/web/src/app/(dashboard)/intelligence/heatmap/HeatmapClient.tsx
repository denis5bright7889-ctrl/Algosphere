'use client'

import { useMemo } from 'react'
import { Grid3x3, Sparkles, Lock } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { HeatmapCell } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd } from '../_components/fmt'
import { cn } from '@/lib/utils'

const METRICS: HeatmapCell['metric'][] = ['liquidity', 'activity', 'inflow', 'smart_money']
const METRIC_LABEL: Record<HeatmapCell['metric'], string> = {
  liquidity: 'Liquidity', activity: 'Activity', inflow: 'Inflow', smart_money: 'Smart $',
}

/** Green-scale intensity from a 0..1 normalised value. */
function cell(v: number): string {
  if (v >= 0.8) return 'bg-emerald-500/80 text-emerald-50'
  if (v >= 0.6) return 'bg-emerald-500/55 text-emerald-50'
  if (v >= 0.4) return 'bg-emerald-500/35 text-emerald-100'
  if (v >= 0.2) return 'bg-emerald-500/20 text-emerald-200'
  return 'bg-muted/30 text-muted-foreground'
}

export default function HeatmapClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<HeatmapCell>('heatmap', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('heatmap', ent.aiNarratives)

  // Pivot flat cells → chain rows × metric columns.
  const { chains, grid } = useMemo(() => {
    const g = new Map<string, Map<string, HeatmapCell>>()
    for (const c of data) {
      if (!g.has(c.chain)) g.set(c.chain, new Map())
      g.get(c.chain)!.set(c.metric, c)
    }
    return { chains: [...g.keys()], grid: g }
  }, [data])

  return (
    <IntelShell
      icon={Grid3x3} title="On-Chain Heatmap"
      subtitle="Cross-chain intensity — liquidity, activity, inflow and smart-money concentration."
      band={meta?.band ?? ent.band} delayed={meta?.delayed ?? !ent.liveData}
      delayMinutes={meta?.delay_minutes ?? ent.delayMinutes} source={meta?.source ?? '…'}
    >
      {ent.aiNarratives && narrative && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.06] p-4">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-300">
            <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden /> AI Summary
          </p>
          <p className="text-sm text-foreground/90">{narrative.body}</p>
        </div>
      )}

      {loading ? (
        <Skeleton />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card p-3">
          <table className="w-full min-w-[480px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">Chain</th>
                {METRICS.map((m) => (
                  <th key={m} className="px-2 py-1 text-center font-medium">{METRIC_LABEL[m]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chains.map((chain) => (
                <tr key={chain}>
                  <td className="px-2 py-1 text-xs font-semibold capitalize">{chain}</td>
                  {METRICS.map((m) => {
                    const c = grid.get(chain)?.get(m)
                    const v = c?.value ?? 0
                    return (
                      <td key={m} className="p-0">
                        <div
                          className={cn('flex h-12 flex-col items-center justify-center rounded-md tabular-nums transition-colors', cell(v))}
                          title={`${chain} · ${METRIC_LABEL[m]} · ${(v * 100).toFixed(0)}%`}
                        >
                          <span className="text-xs font-bold">{(v * 100).toFixed(0)}</span>
                          {ent.advancedHeatmap && c?.raw_usd != null && (
                            <span className="text-[9px] opacity-80">{usd(c.raw_usd)}</span>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {!ent.advancedHeatmap && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" strokeWidth={2} aria-hidden />
              Underlying $ depth is an Institutional feature.{' '}
              <a href="/upgrade" className="font-semibold text-amber-300 underline hover:no-underline">Upgrade</a>
            </p>
          )}
        </div>
      )}
    </IntelShell>
  )
}

function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading on-chain heatmap…</div>
}
