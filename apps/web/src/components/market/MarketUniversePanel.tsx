import { Radio, CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { universeCoverage, UNIVERSE_TOTAL } from '@/lib/market-universe'

/**
 * Market Universe coverage — the engine's taxonomy made visible,
 * honestly. Crypto shows as genuinely live (real exchange feed);
 * every other class is shown as catalogued with "feed not connected"
 * rather than faked. No prices are rendered here by design — this is
 * the universe map, not a quote board.
 */
export default function MarketUniversePanel() {
  const cov = universeCoverage()
  const liveClasses = cov.filter((c) => c.live).length

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Market Universe
        </h2>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {UNIVERSE_TOTAL} instruments · {liveClasses}/{cov.length} classes live
        </span>
      </div>
      <p className="mb-4 text-[11px] text-muted-foreground">
        The platform&apos;s canonical asset taxonomy. Crypto streams from a real
        exchange feed; other classes are catalogued and activate the moment their
        market-data feed is connected — quotes are never fabricated in the interim.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cov.map((c) => (
          <div
            key={c.assetClass}
            className={cn(
              'rounded-xl border p-3',
              c.live
                ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                : 'border-border/60 bg-background/40',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold">{c.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{c.count}</span>
            </div>
            <span
              className={cn(
                'mt-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                c.live
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-border bg-muted/30 text-muted-foreground',
              )}
            >
              {c.live ? (
                <><Radio className="h-2.5 w-2.5 animate-pulse-soft" strokeWidth={2.5} aria-hidden /> Live · {c.liveCount}</>
              ) : (
                <><CircleSlash className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden /> Feed not connected</>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
