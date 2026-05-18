'use client'

import { useMemo } from 'react'
import { Waves, Sparkles, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { WhaleFlow } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, ago, CHAIN_CLS } from '../_components/fmt'
import { cn } from '@/lib/utils'

const DIR_CLS: Record<WhaleFlow['direction'], string> = {
  in:         'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  accumulate: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  out:        'border-rose-500/40 bg-rose-500/10 text-rose-300',
  distribute: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

export default function WhaleFlowsClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<WhaleFlow>('whale-flows', { limit: ent.rowLimit })
  const narrative = useIntelNarrative('whale-flows', ent.aiNarratives)

  const tally = useMemo(() => {
    let inflow = 0, outflow = 0, smart = 0
    for (const r of data) {
      if (r.direction === 'in' || r.direction === 'accumulate') inflow += r.amount_usd
      else outflow += r.amount_usd
      if (r.is_smart_money) smart += r.amount_usd
    }
    return { inflow, outflow, smart, net: inflow - outflow }
  }, [data])

  return (
    <IntelShell
      icon={Waves} title="Whale Flows"
      subtitle="Large wallet movements, accumulation vs distribution, smart-money tagged."
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

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Accumulation" value={usd(tally.inflow)} tone="up" />
        <Stat label="Distribution" value={usd(tally.outflow)} tone="down" />
        <Stat label="Net flow" value={usd(tally.net)} tone={tally.net >= 0 ? 'up' : 'down'} />
        <Stat label="Smart-money vol" value={usd(tally.smart)} tone="neutral" />
      </div>

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
                    {r.is_smart_money && <SmartDot />}
                  </span>
                  <DirTag d={r.direction} />
                </div>
                <p className="mt-1 text-sm font-bold tabular-nums text-foreground">{usd(r.amount_usd)}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {r.from_label ?? '—'} → {r.to_label ?? '—'} · {ago(r.observed_at)} ago
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
                  <th className="px-4 py-2.5 font-medium">Direction</th>
                  <th className="px-4 py-2.5 font-medium">From → To</th>
                  <th className="px-4 py-2.5 text-right font-medium">Size</th>
                  <th className="px-4 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-mono font-semibold">
                      <span className="flex items-center gap-1.5">{r.token_symbol}{r.is_smart_money && <SmartDot />}</span>
                    </td>
                    <td className="px-4 py-2.5"><ChainTag c={r.chain} /></td>
                    <td className="px-4 py-2.5"><DirTag d={r.direction} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[220px]">{r.from_label ?? '—'} → {r.to_label ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{usd(r.amount_usd)}</td>
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

function Stat({ label, value, tone }: { label: string; value: string; tone: 'up' | 'down' | 'neutral' }) {
  const c = tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-rose-300' : 'text-foreground'
  return (
    <div className="rounded-xl border border-border/70 glass p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-bold tabular-nums', c)}>{value}</p>
    </div>
  )
}
function DirTag({ d }: { d: WhaleFlow['direction'] }) {
  const up = d === 'in' || d === 'accumulate'
  const Icon = up ? ArrowDownRight : ArrowUpRight
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize', DIR_CLS[d])}>
      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />{d}
    </span>
  )
}
function ChainTag({ c }: { c: string }) {
  return <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize', CHAIN_CLS[c] ?? 'border-border text-muted-foreground')}>{c}</span>
}
function SmartDot() {
  return <span title="Smart money" className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" aria-label="smart money" />
}
function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading whale flows…</div>
}
