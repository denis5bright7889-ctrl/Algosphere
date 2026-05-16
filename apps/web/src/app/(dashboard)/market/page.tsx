import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Market Tracker — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function MarketTrackerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Trending traders: top by 24h rank change
  const { data: traders } = await supabase
    .from('trader_scores')
    .select(`
      user_id, composite_score, rank_change_24h, win_rate,
      monthly_return_pct, followers_count, risk_label,
      profiles!inner ( public_handle, bio )
    `)
    .gte('total_trades', 10)
    .order('rank_change_24h', { ascending: false })
    .limit(8)

  // Trending pairs: by signal volume + win rate over last 7d
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data: signals } = await supabase
    .from('signals')
    .select('pair, result, pips_gained, published_at')
    .gte('published_at', sevenDaysAgo)

  // Aggregate signals → pair stats
  const pairMap = new Map<string, { count: number; wins: number; pips: number }>()
  for (const s of signals ?? []) {
    const k = s.pair as string
    const v = pairMap.get(k) ?? { count: 0, wins: 0, pips: 0 }
    v.count += 1
    if (s.result === 'win') v.wins += 1
    v.pips += Number(s.pips_gained ?? 0)
    pairMap.set(k, v)
  }
  const pairs = Array.from(pairMap.entries())
    .map(([pair, v]) => ({
      pair,
      count:    v.count,
      win_rate: v.count > 0 ? Math.round((v.wins / v.count) * 100) : 0,
      net_pips: Math.round(v.pips * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Fear & Greed proxy: average pair volatility from recent signal pip ranges
  // (low absolute net pips + high count = ranging/fear; high pips moves = greed)
  const avgAbsPips = pairs.length > 0
    ? pairs.reduce((s, p) => s + Math.abs(p.net_pips), 0) / pairs.length
    : 0
  const fg = Math.max(0, Math.min(100, Math.round(50 + avgAbsPips / 4)))
  const fgLabel = fg >= 75 ? 'Extreme Greed'
                : fg >= 60 ? 'Greed'
                : fg >= 40 ? 'Neutral'
                : fg >= 25 ? 'Fear'
                : 'Extreme Fear'

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Market <span className="text-gradient">Tracker</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Trending traders, hottest pairs, and the platform fear & greed pulse.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <FearGreedGauge value={fg} label={fgLabel} />
        <div className="md:col-span-2 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Pair Volume Heatmap (7d)
          </h2>
          {pairs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No signal data in the last 7 days.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {pairs.slice(0, 6).map(p => {
                const intensity = Math.min(1, p.count / 12)
                return (
                  <div
                    key={p.pair}
                    className="rounded-lg border border-border/60 p-3 transition-colors"
                    // eslint-disable-next-line react/forbid-dom-props
                    style={{
                      backgroundColor: p.net_pips >= 0
                        ? `rgba(52, 211, 153, ${intensity * 0.18})`
                        : `rgba(251, 113, 133, ${intensity * 0.18})`,
                      borderColor: p.net_pips >= 0
                        ? `rgba(52, 211, 153, ${intensity * 0.4})`
                        : `rgba(251, 113, 133, ${intensity * 0.4})`,
                    }}
                  >
                    <p className="text-sm font-bold">{p.pair}</p>
                    <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                      {p.count} signals · {p.win_rate}% wr
                    </p>
                    <p className={cn(
                      'text-xs font-bold tabular-nums mt-1',
                      p.net_pips >= 0 ? 'text-emerald-400' : 'text-rose-400',
                    )}>
                      {p.net_pips >= 0 ? '+' : ''}{p.net_pips} pips
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Trending Traders */}
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
        Trending Traders (24h rank movers)
      </h2>
      {!traders || traders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No trending traders yet — log trades and publish your profile to appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {traders.map((t: any) => (
            <a
              key={t.user_id}
              href={`/traders/${t.profiles?.public_handle ?? ''}`}
              className="group rounded-2xl border border-border bg-card p-4 hover:border-amber-500/40 transition-colors flex items-center gap-3"
            >
              <span className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400/40 to-amber-700/40 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-300 flex-shrink-0">
                {(t.profiles?.public_handle ?? '?')[0].toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold group-hover:text-amber-300 transition-colors truncate">
                  @{t.profiles?.public_handle}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  WR {t.win_rate ?? '—'}% · {t.monthly_return_pct != null
                    ? `${t.monthly_return_pct >= 0 ? '+' : ''}${t.monthly_return_pct.toFixed(1)}%/mo`
                    : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-amber-300 tabular-nums">
                  {Math.round(t.composite_score)}
                </p>
                {t.rank_change_24h > 0 && (
                  <p className="text-[10px] text-emerald-400 tabular-nums">▲ {t.rank_change_24h}</p>
                )}
                {t.rank_change_24h < 0 && (
                  <p className="text-[10px] text-rose-400 tabular-nums">▼ {Math.abs(t.rank_change_24h)}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}

      <p className="mt-6 text-[10px] text-muted-foreground text-center">
        Pair volatility and crypto whale flow data activate when the chain-engine
        service is deployed. <a href="/dashboard/learn" className="text-amber-300 hover:underline">Learn how →</a>
      </p>
    </div>
  )
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const tone = value >= 75 ? 'text-rose-400'
              : value >= 60 ? 'text-amber-300'
              : value >= 40 ? 'text-muted-foreground'
              : value >= 25 ? 'text-blue-300'
              : 'text-emerald-400'
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center justify-center">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
        Fear & Greed
      </p>
      <p className={cn('text-5xl font-bold tabular-nums mt-2', tone)}>{value}</p>
      <p className={cn('text-xs font-bold mt-1 uppercase tracking-wider', tone)}>{label}</p>
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden mt-3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"
          // eslint-disable-next-line react/forbid-dom-props
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}
