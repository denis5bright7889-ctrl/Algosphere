/**
 * Market Pulse — crypto market breadth (Phase 7).
 *
 * The classic institutional market-overview panel: total market cap +
 * 24h direction, BTC/ETH/alt dominance with a Risk-On/Off read, and the
 * day's top movers + trending coins. Sourced from CoinGecko, heavily
 * cached at the fetch layer so the whole user base shares a few calls.
 *
 * Server component, auth-gated via the shared Intelligence guard. When the
 * provider is unconfigured or partial, we say so honestly (no faked rows).
 */
import { loadIntelContext } from '../_components/guard'
import { composeMarketOverview, type DominanceView, type MoverRow } from '@/lib/coingecko'
import { cn } from '@/lib/utils'
import { OpenChartButton } from '@/components/charts'

export const metadata = { title: 'Market Pulse — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

const usd = (n: number, frac = 2) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`

function compactUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`
  return usd(n, 0)
}

// Price precision scales with magnitude — sub-$1 alts need more decimals.
function price(n: number): string {
  if (n >= 1000) return usd(n, 0)
  if (n >= 1)    return usd(n, 2)
  if (n >= 0.01) return usd(n, 4)
  return usd(n, 6)
}

export default async function MarketPulsePage() {
  await loadIntelContext()
  const view = await composeMarketOverview()

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Market Pulse</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crypto market breadth — total capitalisation, BTC/ETH dominance, and
          the day&apos;s strongest and weakest names. The Risk-On/Off read is a
          coarse environment frame, not a position recommendation.
        </p>
      </header>

      {view.dominance ? (
        <DominancePanel d={view.dominance} />
      ) : (
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          Dominance data unavailable{view.reason ? ` — ${view.reason}` : '.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MoversCard title="Top Gainers" tone="up"   rows={view.top_gainers} />
        <MoversCard title="Top Losers"  tone="down" rows={view.top_losers} />
      </div>

      {view.trending.length > 0 && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Trending
          </h2>
          <div className="flex flex-wrap gap-2">
            {view.trending.map((s) => (
              <span key={s}
                    className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      <footer className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Source: CoinGecko</span>
        <span className="flex items-center gap-2">
          {view.partial && <span className="text-amber-400">Partial data</span>}
          <span>Updated {new Date(view.generated_at).toLocaleTimeString()}</span>
        </span>
      </footer>
    </main>
  )
}

// ── Dominance / breadth header ───────────────────────────────────────────

function DominancePanel({ d }: { d: DominanceView }) {
  const up = d.mcap_change_24h >= 0
  const tone = sentimentTone(d.sentiment)
  return (
    <section className={cn('rounded-xl border bg-card p-6 shadow-sm', tone.border)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Total Market Cap
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{compactUsd(d.total_mcap_usd)}</span>
            <span className={cn('text-sm font-semibold tabular-nums', up ? 'text-emerald-400' : 'text-rose-400')}>
              {up ? '+' : ''}{d.mcap_change_24h}%
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            24h volume {compactUsd(d.total_volume_usd)}
          </div>
        </div>
        <span className={cn('shrink-0 rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-wider', tone.pill)}>
          {d.sentiment}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <DomCell label="BTC" value={d.btc_dominance} accent="text-amber-300" />
        <DomCell label="ETH" value={d.eth_dominance} accent="text-sky-300" />
        <DomCell label="Alts" value={d.alt_dominance} accent="text-violet-300" />
      </div>
      <DominanceBar btc={d.btc_dominance} eth={d.eth_dominance} alt={d.alt_dominance} />
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

function DominanceBar({ btc, eth, alt }: { btc: number; eth: number; alt: number }) {
  return (
    <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted/30">
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div className="bg-amber-400/80"  style={{ width: `${btc}%` }} />
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div className="bg-sky-400/80"    style={{ width: `${eth}%` }} />
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div className="bg-violet-400/70" style={{ width: `${alt}%` }} />
    </div>
  )
}

// ── Movers ───────────────────────────────────────────────────────────────

function MoversCard({ title, tone, rows }: { title: string; tone: 'up' | 'down'; rows: MoverRow[] }) {
  const color = tone === 'up' ? 'text-emerald-400' : 'text-rose-400'
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.symbol + r.name} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 font-semibold">{r.symbol}</span>
              <span className="hidden flex-1 truncate text-xs text-muted-foreground sm:block">{r.name}</span>
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{price(r.price_usd)}</span>
              <span className={cn('w-20 shrink-0 text-right font-semibold tabular-nums', color)}>
                {r.change_24h >= 0 ? '+' : ''}{r.change_24h}%
              </span>
              <OpenChartButton symbol={r.symbol} assetClass="crypto" variant="icon" />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Tones ────────────────────────────────────────────────────────────────

function sentimentTone(s: DominanceView['sentiment']): { border: string; pill: string } {
  switch (s) {
    case 'Risk-On':
      return { border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    case 'Risk-Off':
      return { border: 'border-rose-500/40', pill: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
    default:
      return { border: 'border-border', pill: 'bg-muted/20 text-muted-foreground border-border' }
  }
}
