import { createClient } from '@/lib/supabase/server'
import Logo from '@/components/brand/Logo'
import { reputation, rankMedal, type LeaderboardRow } from '@/lib/leaderboard'
import { cn } from '@/lib/utils'

export const metadata = {
  title: 'Trader Leaderboard — AlgoSphere Quant',
  description: 'Verified, journal-backed performance rankings of AlgoSphere Quant traders. Real stats, opt-in, no self-reported numbers.',
}

export const revalidate = 120 // public, cacheable

export default async function LeaderboardPage() {
  const supabase = await createClient()
  const { data } = await supabase.rpc('trader_leaderboard', { p_min_trades: 5 })
  const rows = (data ?? []) as LeaderboardRow[]

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Logo size="sm" alt="" priority />
            <span><span className="text-gradient">AlgoSphere</span> Quant</span>
          </a>
          <a href="/signup" className="btn-premium !text-xs !py-2">Start free trial</a>
        </div>
      </header>

      <section className="relative mx-auto max-w-5xl px-4 py-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh opacity-50 pointer-events-none" aria-hidden />
        <div className="relative text-center mb-10">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            Verified · Journal-backed
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
            Trader <span className="text-gradient">Leaderboard</span>
          </h1>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
            Ranked by a volume-shrunk consistency score — no self-reported numbers,
            no cherry-picking. Only aggregate stats from real trade journals.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="relative rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground">
              No ranked traders yet. Be the first — log trades, then publish your
              profile in Settings.
            </p>
            <a href="/signup" className="btn-premium mt-5 inline-block !text-sm">Get started</a>
          </div>
        ) : (
          <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Trader</th>
                    <th className="px-4 py-3 font-medium text-right">Score</th>
                    <th className="px-4 py-3 font-medium text-right">Win rate</th>
                    <th className="px-4 py-3 font-medium text-right">Trades</th>
                    <th className="px-4 py-3 font-medium text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rep = reputation(r.score)
                    return (
                      <tr key={r.handle} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-bold tabular-nums">{rankMedal(i)}</td>
                        <td className="px-4 py-3">
                          <a href={`/traders/${r.handle}`} className="group inline-flex items-center gap-2">
                            <span className="font-semibold group-hover:text-amber-300 transition-colors">
                              {r.handle}
                            </span>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', rep.cls)}>
                              {rep.label}
                            </span>
                          </a>
                          {r.bio && (
                            <p className="text-xs text-muted-foreground truncate max-w-[260px]">{r.bio}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-300">{r.score}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.win_rate}%</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.trades}</td>
                        <td className={cn(
                          'px-4 py-3 text-right font-semibold tabular-nums',
                          r.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
                        )}>
                          {r.total_pnl >= 0 ? '+' : ''}${r.total_pnl.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="relative mt-6 text-center text-xs text-muted-foreground">
          Minimum 5 logged trades to rank. Score = win rate × volume-confidence
          (a single lucky trade can&apos;t top the board).
        </p>
      </section>
    </main>
  )
}
