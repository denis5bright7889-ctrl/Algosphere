'use client'

import { useMemo } from 'react'
import { BrainCircuit, Sparkles } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { SmartMoneyBuy } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, ago, CHAIN_CLS } from '../_components/fmt'
import { cn } from '@/lib/utils'

export default function SmartMoneyClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<SmartMoneyBuy>('smart-money', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('smart-money', ent.aiNarratives)

  // Sector rollup from the live rows (conviction-weighted).
  const sectors = useMemo(() => {
    const m = new Map<string, { flow: number; n: number }>()
    for (const r of data) {
      const k = r.sector ?? 'Other'
      const e = m.get(k) ?? { flow: 0, n: 0 }
      e.flow += r.amount_usd; e.n += 1
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[1].flow - a[1].flow).slice(0, 6)
  }, [data])

  return (
    <IntelShell
      icon={BrainCircuit} title="Smart Money"
      subtitle="Top wallet accumulation, large buys and conviction scoring across chains."
      band={meta?.band ?? ent.band} delayed={meta?.delayed ?? !ent.liveData}
      delayMinutes={meta?.delay_minutes ?? ent.delayMinutes} source={meta?.source ?? '…'}
    >
      {/* AI narrative — ELITE+ only */}
      {ent.aiNarratives && narrative && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.06] p-4">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-300">
            <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden /> AI Summary
          </p>
          <p className="text-sm text-foreground/90">{narrative.body}</p>
        </div>
      )}

      {/* Sector rotation strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {sectors.map(([sector, v]) => (
          <div key={sector} className="rounded-xl border border-border/70 glass p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{sector}</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-emerald-300">{usd(v.flow)}</p>
            <p className="text-[10px] text-muted-foreground">{v.n} buys</p>
          </div>
        ))}
      </div>

      {/* Accumulation table */}
      {loading ? (
        <Skeleton />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {data.map((r) => (
              <li key={r.id} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm font-semibold truncate">{r.token_symbol}</span>
                    <ChainTag c={r.chain} />
                  </span>
                  <span className="tabular-nums text-sm font-bold text-emerald-300">{usd(r.amount_usd)}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground truncate">
                  {r.wallet_label ?? r.wallet_address} · {r.sector ?? '—'} · {ago(r.observed_at)} ago
                </p>
                <Conviction v={r.conviction} />
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-border/70 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Wallet</th>
                  <th className="px-4 py-2.5 font-medium">Token</th>
                  <th className="px-4 py-2.5 font-medium">Chain</th>
                  <th className="px-4 py-2.5 font-medium">Sector</th>
                  <th className="px-4 py-2.5 text-right font-medium">Size</th>
                  <th className="px-4 py-2.5 font-medium">Conviction</th>
                  <th className="px-4 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-medium truncate max-w-[160px]">{r.wallet_label ?? r.wallet_address}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold">{r.token_symbol}</td>
                    <td className="px-4 py-2.5"><ChainTag c={r.chain} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.sector ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-300">{usd(r.amount_usd)}</td>
                    <td className="px-4 py-2.5 w-40"><Conviction v={r.conviction} /></td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{ago(r.observed_at)}</td>
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
function Conviction({ v }: { v: number | null }) {
  // Source provided no score → say so. Never a fabricated bar.
  if (v == null) {
    return (
      <span
        title="The configured data source did not provide a conviction/score column for this row."
        className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted/40"
      >
        Unrated
      </span>
    )
  }
  const p = Math.round(v * 100)
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
        <span className={cn('block h-full rounded-full', p >= 75 ? 'bg-emerald-500' : p >= 55 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${p}%` }} />
      </span>
      <span className="w-8 text-right text-[11px] tabular-nums">{p}</span>
    </span>
  )
}
function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading smart-money flows…</div>
}
