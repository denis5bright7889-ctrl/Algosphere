'use client'

import { TrendingUp, Sparkles } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { TokenMomentum } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, pct, CHAIN_CLS } from '../_components/fmt'
import { cn } from '@/lib/utils'

export default function TokenMomentumClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<TokenMomentum>('token-momentum', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('token-momentum', ent.aiNarratives)

  return (
    <IntelShell
      icon={TrendingUp} title="Token Momentum"
      subtitle="Composite of inflow, volume acceleration, holder growth and smart-money exposure."
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
        <>
          <ul className="space-y-2 md:hidden">
            {data.map((r, i) => (
              <li key={`${r.token_symbol}-${i}`} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{r.token_symbol}</span>
                    <ChainTag c={r.chain} />
                  </span>
                  <Score v={r.momentum_score} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  inflow {usd(r.inflow_usd)} · vol {pct(r.volume_delta_pct)} · holders {pct(r.wallet_growth_pct)} · SM {Math.round(r.smart_money_exposure_pct * 100)}%
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-border/70 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Token</th>
                  <th className="px-4 py-2.5 font-medium">Chain</th>
                  <th className="px-4 py-2.5 text-right font-medium">Inflow</th>
                  <th className="px-4 py-2.5 text-right font-medium">Vol Δ</th>
                  <th className="px-4 py-2.5 text-right font-medium">Holder Δ</th>
                  <th className="px-4 py-2.5 text-right font-medium">SM exp.</th>
                  <th className="px-4 py-2.5 font-medium">Momentum</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={`${r.token_symbol}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-mono font-semibold">{r.token_symbol}</td>
                    <td className="px-4 py-2.5"><ChainTag c={r.chain} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{usd(r.inflow_usd)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', r.volume_delta_pct >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{pct(r.volume_delta_pct)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', r.wallet_growth_pct >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{pct(r.wallet_growth_pct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{Math.round(r.smart_money_exposure_pct * 100)}%</td>
                    <td className="px-4 py-2.5 w-44"><Score v={r.momentum_score} /></td>
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

function Score({ v }: { v: number }) {
  const c = v >= 70 ? 'bg-emerald-500' : v >= 45 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 flex-1 overflow-hidden rounded-full bg-muted/40">
        <span className={cn('block h-full rounded-full', c)} style={{ width: `${v}%` }} />
      </span>
      <span className="w-7 text-right text-[11px] tabular-nums font-semibold">{v}</span>
    </span>
  )
}
function ChainTag({ c }: { c: string }) {
  return <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize', CHAIN_CLS[c] ?? 'border-border text-muted-foreground')}>{c}</span>
}
function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading token momentum…</div>
}
