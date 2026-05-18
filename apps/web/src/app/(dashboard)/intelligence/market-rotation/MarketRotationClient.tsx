'use client'

import { Repeat, Sparkles } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { SectorRotation } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, pct } from '../_components/fmt'
import { cn } from '@/lib/utils'

export default function MarketRotationClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<SectorRotation>('market-rotation', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('market-rotation', ent.aiNarratives)

  return (
    <IntelShell
      icon={Repeat} title="Market Rotation"
      subtitle="Where capital is rotating — sector strength, 7-day flow and narrative."
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((r) => (
            <div key={r.sector} className="rounded-2xl border border-border/70 bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{r.sector}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
                  r.delta_7d_pct >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
                  {pct(r.delta_7d_pct)} 7d
                </span>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Strength</span><span className="tabular-nums">{r.strength_score}/100</span>
                </div>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted/40">
                  <span
                    className={cn('block h-full rounded-full',
                      r.strength_score >= 66 ? 'bg-emerald-500' : r.strength_score >= 40 ? 'bg-amber-500' : 'bg-rose-500')}
                    style={{ width: `${r.strength_score}%` }}
                  />
                </span>
              </div>

              <p className={cn('mt-3 text-sm font-bold tabular-nums',
                r.capital_flow_usd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                {usd(r.capital_flow_usd)} <span className="text-[10px] font-normal text-muted-foreground">net flow</span>
              </p>

              {r.narrative && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{r.narrative}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </IntelShell>
  )
}

function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading market rotation…</div>
}
