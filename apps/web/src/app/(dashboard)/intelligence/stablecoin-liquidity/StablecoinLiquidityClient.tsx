'use client'

import { useMemo } from 'react'
import { Coins, Sparkles } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { StablecoinFlow } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, pct, CHAIN_CLS } from '../_components/fmt'
import { cn } from '@/lib/utils'

export default function StablecoinLiquidityClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<StablecoinFlow>('stablecoin-liquidity', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('stablecoin-liquidity', ent.aiNarratives)

  const totalNet = useMemo(() => data.reduce((s, r) => s + r.net_inflow_usd, 0), [data])
  const byStable = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data) m.set(r.stable, (m.get(r.stable) ?? 0) + r.net_inflow_usd)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  return (
    <IntelShell
      icon={Coins} title="Stablecoin Liquidity"
      subtitle="Net mint/burn — dry powder entering or leaving the on-chain economy."
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

      <div className="rounded-2xl border border-border/70 glass p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aggregate net liquidity (window)</p>
        <p className={cn('mt-1 text-2xl font-bold tabular-nums', totalNet >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
          {usd(totalNet)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {byStable.map(([s, v]) => (
            <div key={s} className="rounded-lg border border-border/60 bg-card/60 p-2">
              <p className="font-mono text-xs font-bold">{s}</p>
              <p className={cn('text-xs tabular-nums', v >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{usd(v)}</p>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {data.map((r, i) => (
              <li key={`${r.stable}-${r.chain}-${i}`} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{r.stable}</span>
                    <ChainTag c={r.chain} />
                  </span>
                  <span className={cn('tabular-nums text-sm font-bold', r.net_inflow_usd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                    {usd(r.net_inflow_usd)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  mint {usd(r.mint_usd)} · burn {usd(r.burn_usd)} · supply {pct(r.delta_supply_pct)}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-border/70 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Stable</th>
                  <th className="px-4 py-2.5 font-medium">Chain</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mint</th>
                  <th className="px-4 py-2.5 text-right font-medium">Burn</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net inflow</th>
                  <th className="px-4 py-2.5 text-right font-medium">Supply Δ</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={`${r.stable}-${r.chain}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-mono font-semibold">{r.stable}</td>
                    <td className="px-4 py-2.5"><ChainTag c={r.chain} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{usd(r.mint_usd)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{usd(r.burn_usd)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', r.net_inflow_usd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                      {usd(r.net_inflow_usd)}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', r.delta_supply_pct >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                      {pct(r.delta_supply_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </IntelShell>
  )
}

function ChainTag({ c }: { c: string }) {
  return <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize', CHAIN_CLS[c] ?? 'border-border text-muted-foreground')}>{c}</span>
}
function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading stablecoin liquidity…</div>
}
