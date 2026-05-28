'use client'

import { useMemo } from 'react'
import { TrendingUp, Sparkles, Crown, Repeat, AlertTriangle, BarChart3 } from 'lucide-react'
import type { IntelEntitlements } from '@/lib/intelligence-entitlements'
import type { TokenMomentum } from '@/services/onchain/types'
import IntelShell from '../_components/IntelShell'
import { useIntel } from '../_components/useIntel'
import { useIntelNarrative } from '../_components/useNarrative'
import { usd, pct, CHAIN_CLS } from '../_components/fmt'
import { cn } from '@/lib/utils'

/**
 * Token Momentum — intelligence-first per the brief (Section 13):
 *   1. AI Narrative
 *   2. Momentum Leaders
 *   3. Smart Money Rotation
 *   4. Exhaustion Watch
 *   5. Relative Strength Rankings
 * Raw table hidden behind an Advanced View toggle so the default
 * experience is institutional cards, never a developer spreadsheet.
 */
export default function TokenMomentumClient({ ent }: { ent: IntelEntitlements }) {
  const { data, meta, loading } = useIntel<TokenMomentum>('token-momentum', { limit: Math.max(40, ent.rowLimit) })
  const narrative = useIntelNarrative('token-momentum', ent.aiNarratives)

  // ── Derived collections (memoised) ───────────────────────────────────
  const leaders = useMemo(
    () => [...data].sort((a, b) => b.momentum_score - a.momentum_score).slice(0, 6),
    [data],
  )
  const smartMoneyRotation = useMemo(
    () => [...data]
      .filter((r) => r.smart_money_exposure_pct > 0)
      .sort((a, b) => b.smart_money_exposure_pct - a.smart_money_exposure_pct)
      .slice(0, 6),
    [data],
  )
  // Exhaustion = high volume / activity but holders/wallets falling — late-cycle warning
  const exhaustionWatch = useMemo(
    () => [...data]
      .filter((r) => r.volume_delta_pct >= 0.15 && r.wallet_growth_pct <= 0)
      .sort((a, b) => Math.abs(a.wallet_growth_pct) - Math.abs(b.wallet_growth_pct))
      .reverse()
      .slice(0, 4),
    [data],
  )
  const ranking = useMemo(
    () => [...data].sort((a, b) => b.momentum_score - a.momentum_score),
    [data],
  )

  return (
    <IntelShell
      icon={TrendingUp} title="Token Momentum"
      subtitle="Per-token on-chain momentum — leaders, smart-money rotation, exhaustion watch."
      band={meta?.band ?? ent.band} delayed={meta?.delayed ?? !ent.liveData}
      delayMinutes={meta?.delay_minutes ?? ent.delayMinutes} source={meta?.source ?? '…'}
    >
      {loading ? (
        <Skeleton />
      ) : data.length === 0 ? (
        <Empty />
      ) : (
        <>
          {/* ── 1. AI Narrative (ELITE+) ──────────────────────────────── */}
          {ent.aiNarratives && narrative && (
            <section className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.06] p-4">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-300">
                <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden /> AI Summary
              </p>
              <p className="text-sm text-foreground/90">{narrative.body}</p>
            </section>
          )}

          {/* ── 2. Momentum Leaders ───────────────────────────────────── */}
          <Section icon={Crown} title="Momentum Leaders"
                   blurb="Highest composite momentum scores across the universe.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {leaders.map((r, i) => <LeaderCard key={`L-${r.token_symbol}-${i}`} row={r} rank={i + 1} />)}
            </div>
          </Section>

          {/* ── 3. Smart Money Rotation ───────────────────────────────── */}
          {smartMoneyRotation.length > 0 && (
            <Section icon={Repeat} title="Smart Money Rotation"
                     blurb="Tokens where institutional wallets hold the largest share.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {smartMoneyRotation.map((r, i) => (
                  <SmRotationCard key={`S-${r.token_symbol}-${i}`} row={r} />
                ))}
              </div>
            </Section>
          )}

          {/* ── 4. Exhaustion Watch ───────────────────────────────────── */}
          {exhaustionWatch.length > 0 && (
            <Section icon={AlertTriangle} title="Exhaustion Watch"
                     blurb="Activity rising but participation thinning — late-cycle warning.">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {exhaustionWatch.map((r, i) => (
                  <li key={`X-${r.token_symbol}-${i}`}
                      className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
                    <span className="text-xs font-mono font-semibold">{r.token_symbol}</span>
                    <ChainTag c={r.chain} />
                    <span className="ml-auto text-[11px] text-amber-200">
                      vol {pct(r.volume_delta_pct)} · holders {pct(r.wallet_growth_pct)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* ── 5. Relative Strength Rankings ─────────────────────────── */}
          <Section icon={BarChart3} title="Relative Strength Rankings"
                   blurb="Full universe ranked by composite momentum.">
            <ol className="space-y-1">
              {ranking.slice(0, 20).map((r, i) => (
                <li key={`R-${r.token_symbol}-${i}`}
                    className="flex items-center gap-3 rounded-md border border-border/50 bg-card/40 px-3 py-2 text-sm">
                  <span className="w-6 shrink-0 text-[10px] tabular-nums text-muted-foreground">#{i + 1}</span>
                  <span className="font-mono font-semibold min-w-[60px]">{r.token_symbol}</span>
                  <ChainTag c={r.chain} />
                  <span className="ml-auto flex items-center gap-3">
                    <span className="hidden text-[10px] text-muted-foreground sm:inline-block">
                      SM {Math.round(r.smart_money_exposure_pct * 100)}%
                    </span>
                    <Score v={r.momentum_score} compact />
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          {/* ── Advanced Raw Table — opt-in, collapsed by default ─────── */}
          <details className="group rounded-2xl border border-border/60 bg-muted/10">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Advanced — raw table
              </span>
              <span className="text-[10px] text-muted-foreground group-open:hidden">show</span>
              <span className="hidden text-[10px] text-muted-foreground group-open:inline">hide</span>
            </summary>
            <div className="overflow-hidden border-t border-border/60">
              <RawTable rows={data} />
            </div>
          </details>
        </>
      )}
    </IntelShell>
  )
}

// ── Sub-section helpers ──────────────────────────────────────────────────

function Section({ icon: Icon, title, blurb, children }: {
  icon: typeof Crown; title: string; blurb: string; children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Icon className="h-3 w-3" strokeWidth={2} aria-hidden /> {title}
        </h2>
        <span className="text-[10px] text-muted-foreground">{blurb}</span>
      </div>
      {children}
    </section>
  )
}

function LeaderCard({ row, rank }: { row: TokenMomentum; rank: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] tabular-nums text-muted-foreground">#{rank}</span>
          <span className="font-mono text-base font-semibold">{row.token_symbol}</span>
          <ChainTag c={row.chain} />
        </div>
        <span className={cn('text-lg font-bold tabular-nums',
          row.momentum_score >= 70 ? 'text-emerald-300' :
          row.momentum_score >= 45 ? 'text-amber-300' : 'text-rose-300')}>
          {row.momentum_score}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Net inflow</span>
        <span className={cn('tabular-nums font-semibold', row.inflow_usd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
          {usd(row.inflow_usd)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Smart-money exp.</span>
        <span className="tabular-nums">{Math.round(row.smart_money_exposure_pct * 100)}%</span>
      </div>
    </div>
  )
}

function SmRotationCard({ row }: { row: TokenMomentum }) {
  const p = Math.round(row.smart_money_exposure_pct * 100)
  return (
    <div className="rounded-xl border border-border/70 glass p-3">
      <p className="font-mono text-sm font-bold">{row.token_symbol}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.chain}</p>
      <p className="mt-1 text-sm font-bold tabular-nums text-emerald-300">{p}%</p>
      <p className="text-[10px] text-muted-foreground">SM exposure</p>
    </div>
  )
}

function Score({ v, compact = false }: { v: number; compact?: boolean }) {
  const c = v >= 70 ? 'bg-emerald-500' : v >= 45 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <span className={cn('flex items-center gap-2', compact ? 'w-24' : '')}>
      <span className={cn('h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40', compact ? '' : 'w-20')}>
        <span className={cn('block h-full rounded-full', c)} style={{ width: `${v}%` }} />
      </span>
      <span className="w-7 text-right text-[11px] tabular-nums font-semibold">{v}</span>
    </span>
  )
}

function ChainTag({ c }: { c: string }) {
  return <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold capitalize', CHAIN_CLS[c] ?? 'border-border text-muted-foreground')}>{c}</span>
}

function RawTable({ rows }: { rows: TokenMomentum[] }) {
  return (
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
        {rows.map((r, i) => (
          <tr key={`raw-${r.token_symbol}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
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
  )
}

function Skeleton() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Loading token momentum…</div>
}
function Empty() {
  return <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
    No token-momentum data right now — Nansen screener returned an empty universe for this window.
  </div>
}
