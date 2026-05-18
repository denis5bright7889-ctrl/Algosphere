'use client'

import { useMemo } from 'react'
import { Building2, Sparkles } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { ExchangeFlow } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, pct, CHAIN_CLS } from '../_components/fmt'
import { cn } from '@/lib/utils'

export default function ExchangeFlowsClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<ExchangeFlow>('exchange-flows', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('exchange-flows', ent.aiNarratives)

  // Net flow per exchange (rolled across chains). Positive = net
  // inflow to exchange = sell pressure; negative = accumulation.
  const byExchange = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data) m.set(r.exchange, (m.get(r.exchange) ?? 0) + r.net_flow_usd)
    return [...m.entries()].sort((a, b) => a[1] - b[1])
  }, [data])

  return (
    <IntelShell
      icon={Building2} title="Exchange Flows"
      subtitle="Net inflow (sell pressure) vs outflow (accumulation) across major exchanges."
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

      {/* Net-flow bias per exchange */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {byExchange.map(([ex, net]) => (
          <div key={ex} className="rounded-xl border border-border/70 glass p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{ex}</p>
            <p className={cn('mt-1 text-sm font-bold tabular-nums', net <= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              {usd(net)}
            </p>
            <p className="text-[10px] text-muted-foreground">{net <= 0 ? 'net outflow' : 'net inflow'}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <Skeleton />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {data.map((r, i) => (
              <li key={`${r.exchange}-${r.chain}-${i}`} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{r.exchange}</span>
                    <ChainTag c={r.chain} />
                  </span>
                  <span className={cn('tabular-nums text-sm font-bold', r.net_flow_usd <= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                    {usd(r.net_flow_usd)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  in {usd(r.inflow_usd)} · out {usd(r.outflow_usd)} · 24h {pct(r.delta_24h_pct)}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-border/70 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Exchange</th>
                  <th className="px-4 py-2.5 font-medium">Chain</th>
                  <th className="px-4 py-2.5 text-right font-medium">Inflow</th>
                  <th className="px-4 py-2.5 text-right font-medium">Outflow</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net</th>
                  <th className="px-4 py-2.5 text-right font-medium">24h Δ</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={`${r.exchange}-${r.chain}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-semibold">{r.exchange}</td>
                    <td className="px-4 py-2.5"><ChainTag c={r.chain} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{usd(r.inflow_usd)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{usd(r.outflow_usd)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums font-semibold', r.net_flow_usd <= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                      {usd(r.net_flow_usd)}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', r.delta_24h_pct >= 0 ? 'text-rose-300' : 'text-emerald-300')}>
                      {pct(r.delta_24h_pct)}
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
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading exchange flows…</div>
}
