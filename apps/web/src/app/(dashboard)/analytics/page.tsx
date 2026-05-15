import { createClient } from '@/lib/supabase/server'
import { computeMetrics, computeDrawdownCurve, interpretSharpe } from '@/lib/analytics/metrics'
import { formatCurrency } from '@/lib/utils'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import type { JournalEntry } from '@/lib/types'
import ProgressBar from '@/components/ui/ProgressBar'
import PnlChart from './PnlChart'
import DrawdownChart from './DrawdownChart'

export const metadata = { title: 'Performance Analytics' }

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item)
    ;(acc[k] ??= []).push(item)
    return acc
  }, {})
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: profile }, { data: raw }] = await Promise.all([
    supabase.from('profiles').select('account_type').eq('id', user!.id).single(),
    supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', user!.id)
      .order('trade_date', { ascending: true }),
  ])

  let entries = (raw ?? []) as JournalEntry[]

  // Demo accounts with no real entries see synthetic analytics
  if (isDemo(profile?.account_type) && entries.length === 0) {
    entries = generateDemoJournal(user!.id, 30)
      .sort((a, b) => (a.trade_date || '').localeCompare(b.trade_date || ''))
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Performance Analytics</h1>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Log trades in your Trade Log to unlock performance analytics.</p>
          <a href="/journal" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Open Trade Log
          </a>
        </div>
      </div>
    )
  }

  const pnlSeries = entries.map(e => e.pnl ?? 0)
  const metrics = computeMetrics(pnlSeries)
  const sharpeInterpret = interpretSharpe(metrics.sharpe_ratio)

  const dated = entries
    .filter(e => e.trade_date && e.pnl != null)
    .map(e => ({ date: e.trade_date!, pnl: e.pnl! }))

  const cumChart = dated.map((d, i) => ({
    date: d.date,
    value: dated.slice(0, i + 1).reduce((s, x) => s + x.pnl, 0),
  }))

  const drawdownCurve = computeDrawdownCurve(dated)

  // Pair breakdown
  const byPair = groupBy(entries, e => e.pair ?? 'Unknown')
  const pairStats = Object.entries(byPair)
    .map(([pair, trades]) => ({
      pair,
      count: trades.length,
      pnl: trades.reduce((s, t) => s + (t.pnl ?? 0), 0),
      winRate: Math.round(trades.filter(t => (t.pnl ?? 0) > 0).length / trades.length * 100),
    }))
    .sort((a, b) => b.pnl - a.pnl)

  // Setup breakdown
  const bySetup = groupBy(entries.filter(e => e.setup_tag), e => e.setup_tag!)
  const setupStats = Object.entries(bySetup)
    .map(([tag, trades]) => ({
      tag,
      count: trades.length,
      pnl: trades.reduce((s, t) => s + (t.pnl ?? 0), 0),
      winRate: Math.round(trades.filter(t => (t.pnl ?? 0) > 0).length / trades.length * 100),
    }))
    .sort((a, b) => b.winRate - a.winRate)

  // Monthly breakdown
  const byMonth: Record<string, number[]> = {}
  entries.forEach(e => {
    if (!e.trade_date || e.pnl == null) return
    const m = e.trade_date.slice(0, 7)
    ;(byMonth[m] ??= []).push(e.pnl)
  })
  const monthlyStats = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnls]) => ({
      month,
      pnl: pnls.reduce((a, b) => a + b, 0),
      trades: pnls.length,
      winRate: Math.round(pnls.filter(p => p > 0).length / pnls.length * 100),
    }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Performance Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Institutional-grade performance attribution · {metrics.total_trades} trades
        </p>
      </div>

      {/* Institutional KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total P&L" value={formatCurrency(metrics.total_pnl)} sub="" color={metrics.total_pnl >= 0 ? 'green' : 'red'} />
        <MetricCard label="Win Rate" value={`${metrics.win_rate}%`} sub={`${metrics.total_trades} trades`} />
        <MetricCard label="Profit Factor" value={metrics.profit_factor === Infinity ? '∞' : String(metrics.profit_factor)} sub={metrics.profit_factor > 1 ? 'Profitable' : 'Unprofitable'} color={metrics.profit_factor >= 1.5 ? 'green' : metrics.profit_factor >= 1 ? 'yellow' : 'red'} />
        <MetricCard label="Expectancy" value={formatCurrency(metrics.expectancy)} sub="per trade" color={metrics.expectancy >= 0 ? 'green' : 'red'} />
      </div>

      {/* Risk-adjusted metrics */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Risk-Adjusted Performance</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 text-sm">
          <RiskMetric label="Sharpe Ratio" value={String(metrics.sharpe_ratio)}
            sub={sharpeInterpret.label} color={sharpeInterpret.color} />
          <RiskMetric label="Sortino Ratio" value={String(metrics.sortino_ratio === 99.99 ? '∞' : metrics.sortino_ratio)}
            sub="Downside-adj." color={metrics.sortino_ratio >= 1 ? 'text-green-600' : 'text-orange-600'} />
          <RiskMetric label="Max Drawdown" value={`${metrics.max_drawdown_pct}%`}
            sub={formatCurrency(metrics.max_drawdown_usd)} color={metrics.max_drawdown_pct < 10 ? 'text-green-600' : metrics.max_drawdown_pct < 20 ? 'text-yellow-600' : 'text-red-600'} />
          <RiskMetric label="Calmar Ratio" value={String(metrics.calmar_ratio)}
            sub="Return/Drawdown" color={metrics.calmar_ratio >= 1 ? 'text-green-600' : 'text-muted-foreground'} />
          <RiskMetric label="Avg Win" value={formatCurrency(metrics.avg_win)} sub="" color="text-green-600" />
          <RiskMetric label="Avg Loss" value={formatCurrency(metrics.avg_loss)} sub="" color="text-red-600" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-muted-foreground border-t border-border pt-4 sm:grid-cols-3 sm:gap-4">
          <div>Best trade: <span className="text-green-600 font-semibold">{formatCurrency(metrics.best_trade)}</span></div>
          <div>Worst trade: <span className="text-red-600 font-semibold">{formatCurrency(metrics.worst_trade)}</span></div>
          <div>Max consec. wins: <span className="font-semibold">{metrics.consecutive_wins}</span> · losses: <span className="font-semibold">{metrics.consecutive_losses}</span></div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Equity Curve</h2>
          <PnlChart data={cumChart} />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Drawdown Underwater Chart</h2>
          <DrawdownChart data={drawdownCurve} />
        </div>
      </div>

      {/* Monthly breakdown */}
      {monthlyStats.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Monthly Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border text-left">
                  <th className="pb-2 pr-4">Month</th>
                  <th className="pb-2 pr-4">Trades</th>
                  <th className="pb-2 pr-4">Win %</th>
                  <th className="pb-2 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {monthlyStats.map(m => (
                  <tr key={m.month} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 font-medium">{m.month}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{m.trades}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={m.winRate} className="w-16 h-1.5" barClassName={m.winRate >= 60 ? 'bg-green-500' : m.winRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'} />
                        <span>{m.winRate}%</span>
                      </div>
                    </td>
                    <td className={`py-2 text-right font-semibold ${m.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(m.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pair + Setup breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {pairStats.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold mb-4">Performance by Instrument</h2>
            <div className="space-y-3">
              {pairStats.map(p => (
                <div key={p.pair} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-medium w-20">{p.pair}</span>
                    <span className="text-xs text-muted-foreground">{p.count} trades · {p.winRate}% win</span>
                  </div>
                  <span className={p.pnl >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                    {formatCurrency(p.pnl)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {setupStats.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold mb-4">Strategy Attribution</h2>
            <div className="space-y-3">
              {setupStats.map(s => (
                <div key={s.tag} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium capitalize">{s.tag}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">{s.count} trades</span>
                      <span className={s.pnl >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                        {s.winRate}% win
                      </span>
                    </div>
                  </div>
                  <ProgressBar value={s.winRate} barClassName={s.winRate >= 60 ? 'bg-green-500' : s.winRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  const border = { green: 'border-l-green-500', red: 'border-l-red-500', yellow: 'border-l-yellow-500' }
  return (
    <div className={`rounded-xl border border-border bg-card p-4 border-l-4 ${border[color as keyof typeof border] ?? 'border-l-primary'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color === 'green' ? 'text-green-600' : color === 'red' ? 'text-red-600' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function RiskMetric({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
