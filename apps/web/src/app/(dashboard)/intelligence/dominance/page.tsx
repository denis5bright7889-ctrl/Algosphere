/**
 * Dominance & rotation — BTC/ETH/alt dominance with a sector-rotation read.
 *
 * Reuses composeMarketOverview (#40) for dominance + composeSectorIntel
 * for the rotation interpretation. Distinct from Market Pulse (which
 * focuses on movers + trending); this page is the dominance + leadership
 * rotation lens. No fabricated flows.
 */
import Link from 'next/link'
import { loadIntelContext } from '../_components/guard'
import { composeMarketOverview, type DominanceView } from '@/lib/coingecko'
import { composeSectorIntel, type SectorRow } from '@/lib/sector-engine'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Dominance & Rotation — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

const compactUsd = (n: number) =>
  n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${n.toFixed(0)}`

export default async function DominancePage() {
  await loadIntelContext()
  const [overview, sectors] = await Promise.all([composeMarketOverview(), composeSectorIntel()])

  const leading  = sectors.sectors.filter((s) => s.state === 'Accelerating' || s.state === 'Strengthening').slice(0, 4)
  const weakening = sectors.sectors.filter((s) => s.state === 'Weakening' || s.state === 'Distributing').slice(0, 4)

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Dominance &amp; <span className="text-gradient">Rotation</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capital concentration across BTC / ETH / alts, and where sector
          leadership is rotating. Complements{' '}
          <Link href="/intelligence/market-pulse" className="text-amber-300 hover:underline">Market Pulse</Link>{' '}
          (movers &amp; trending) with the leadership lens.
        </p>
      </header>

      {overview.dominance ? <DominanceBoard d={overview.dominance} /> : (
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          Dominance unavailable{overview.reason ? ` — ${overview.reason}` : '.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RotationColumn title="Leadership (where capital is rotating in)" rows={leading} tone="up" empty="No sectors accelerating right now." />
        <RotationColumn title="Weakening (where capital is rotating out)" rows={weakening} tone="down" empty="No sectors distributing right now." />
      </div>

      <footer className="text-[11px] text-muted-foreground">
        Source: CoinGecko global + sector taxonomy · updated {new Date(overview.generated_at).toLocaleTimeString()}
      </footer>
    </main>
  )
}

function DominanceBoard({ d }: { d: DominanceView }) {
  const up = d.mcap_change_24h >= 0
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total market cap</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{compactUsd(d.total_mcap_usd)}</span>
            <span className={cn('text-sm font-semibold tabular-nums', up ? 'text-emerald-400' : 'text-rose-400')}>
              {up ? '+' : ''}{d.mcap_change_24h}%
            </span>
          </div>
        </div>
        <span className={cn(
          'shrink-0 rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-wider',
          d.sentiment === 'Risk-On'  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400' :
          d.sentiment === 'Risk-Off' ? 'border-rose-500/40 bg-rose-500/15 text-rose-400' :
                                       'border-border bg-muted/20 text-muted-foreground',
        )}>{d.sentiment}</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <DomCell label="BTC"  value={d.btc_dominance} accent="text-amber-300" />
        <DomCell label="ETH"  value={d.eth_dominance} accent="text-sky-300" />
        <DomCell label="Alts" value={d.alt_dominance} accent="text-violet-300" />
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted/30">
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div className="bg-amber-400/80"  style={{ width: `${d.btc_dominance}%` }} />
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div className="bg-sky-400/80"    style={{ width: `${d.eth_dominance}%` }} />
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div className="bg-violet-400/70" style={{ width: `${d.alt_dominance}%` }} />
      </div>
    </section>
  )
}

function DomCell({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label} dominance</div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums', accent)}>{value}%</div>
    </div>
  )
}

function RotationColumn({ title, rows, tone, empty }: {
  title: string; rows: SectorRow[]; tone: 'up' | 'down'; empty: string
}) {
  const color = tone === 'up' ? 'text-emerald-400' : 'text-rose-400'
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-4">
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.sector} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">{r.state}</span>
              </div>
              <span className={cn('shrink-0 text-sm font-semibold tabular-nums', color)}>
                {r.avg_change_24h >= 0 ? '+' : ''}{r.avg_change_24h}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/intelligence/sectors" className="mt-3 inline-block text-[11px] text-amber-300/80 hover:text-amber-300">
        Full sector intelligence →
      </Link>
    </section>
  )
}
