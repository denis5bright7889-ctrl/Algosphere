import { MARKET_UNIVERSE, UNIVERSE_TOTAL } from '@/lib/market-universe'

/**
 * Credibility band. Every number is derived from a source-of-truth
 * module or is a verifiable platform fact — no fabricated AUM, returns,
 * or user counts (the platform's no-invention policy applies here too).
 */
const STATS: { value: string; label: string }[] = [
  { value: `${UNIVERSE_TOTAL}+`,            label: 'Instruments tracked live' },
  { value: `${MARKET_UNIVERSE.length}`,     label: 'Asset classes covered' },
  { value: '12',                            label: 'Capital-risk gates enforced' },
  { value: '4',                             label: 'Execution venues (Binance · Bybit · OKX · MT5)' },
]

export default function StatsBand() {
  return (
    <section className="border-y border-border/60 bg-muted/20">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-px overflow-hidden px-4 py-8 sm:py-10 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="px-3 py-3 text-center">
            <div className="text-2xl font-extrabold tabular-nums text-gradient sm:text-3xl">
              {s.value}
            </div>
            <div className="mt-1 text-[11px] leading-tight text-muted-foreground sm:text-xs">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
