import { createClient as serviceClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/utils'
import UserTable from './UserTable'
import AdminCharts from './AdminCharts'
import SystemHealth from './SystemHealth'

export const metadata = { title: 'Admin — Dashboard' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function fetchAnalytics() {
  const svc = db()
  const now = new Date()
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString()
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString()

  const [
    { data: profiles },
    { data: payments },
    { data: signals },
    { data: trades },
  ] = await Promise.all([
    svc.from('profiles').select('id, full_name, subscription_tier, subscription_status, created_at'),
    svc.from('crypto_payments').select('id, plan, amount_usd, status, created_at, reviewed_at'),
    svc.from('signals').select('id, pair, direction, status, result, tier_required, published_at'),
    svc.from('journal_entries').select('id, user_id, pnl, pips, pair, setup_tag, trade_date'),
  ])

  const p = profiles ?? []
  const pay = payments ?? []
  const sig = signals ?? []
  const tr = trades ?? []

  // Users
  const totalUsers = p.length
  const byTier = {
    free: p.filter(x => x.subscription_tier === 'free').length,
    starter: p.filter(x => x.subscription_tier === 'starter').length,
    premium: p.filter(x => x.subscription_tier === 'premium').length,
  }
  const trialing = p.filter(x => x.subscription_status === 'trialing').length
  const newLast7 = p.filter(x => x.created_at >= d7).length
  const newLast30 = p.filter(x => x.created_at >= d30).length

  // Signup chart (last 30 days)
  const signupByDay: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    signupByDay[d.toISOString().slice(0, 10)] = 0
  }
  p.forEach(u => {
    const day = u.created_at?.slice(0, 10)
    if (day && day in signupByDay) signupByDay[day] = (signupByDay[day] ?? 0) + 1
  })
  const signupChart = Object.entries(signupByDay).map(([date, count]) => ({ date, count }))

  // Revenue
  const approved = pay.filter(x => x.status === 'approved')
  const totalRevenue = approved.reduce((s, x) => s + (x.amount_usd ?? 0), 0)
  const pending = pay.filter(x => x.status === 'pending_review').length

  const revenueByMonth: Record<string, number> = {}
  approved.forEach(x => {
    const month = (x.reviewed_at ?? x.created_at)?.slice(0, 7)
    if (month) revenueByMonth[month] = (revenueByMonth[month] ?? 0) + (x.amount_usd ?? 0)
  })
  const revenueChart = Object.entries(revenueByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, revenue]) => ({ month, revenue }))

  // Signals
  const closed = sig.filter(x => x.status === 'closed')
  const wins = closed.filter(x => x.result === 'win').length
  const signalWinRate = closed.length ? Math.round((wins / closed.length) * 100) : 0
  const pairCount: Record<string, number> = {}
  sig.forEach(s => { if (s.pair) pairCount[s.pair] = (pairCount[s.pair] ?? 0) + 1 })
  const topPairs = Object.entries(pairCount).sort(([, a], [, b]) => b - a).slice(0, 5).map(([pair, count]) => ({ pair, count }))

  // Trades
  const totalPnl = tr.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const profWinRate = tr.length ? Math.round(tr.filter(t => (t.pnl ?? 0) > 0).length / tr.length * 100) : 0
  const userPnl: Record<string, number> = {}
  tr.forEach(t => { userPnl[t.user_id] = (userPnl[t.user_id] ?? 0) + (t.pnl ?? 0) })
  const topTraders = Object.entries(userPnl).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, pnl]) => ({ id: id.slice(0, 8) + '…', pnl }))

  const setupCount: Record<string, number> = {}
  tr.filter(t => t.setup_tag).forEach(t => { setupCount[t.setup_tag!] = (setupCount[t.setup_tag!] ?? 0) + 1 })
  const topSetups = Object.entries(setupCount).sort(([, a], [, b]) => b - a).slice(0, 5).map(([tag, count]) => ({ tag, count }))

  return {
    users: { totalUsers, byTier, trialing, newLast7, newLast30, signupChart },
    revenue: { totalRevenue, pending, revenueChart, totalApproved: approved.length },
    signals: { total: sig.length, active: sig.filter(x => x.status === 'active').length, wins, losses: closed.filter(x => x.result === 'loss').length, winRate: signalWinRate, topPairs },
    trades: { total: tr.length, totalPnl, winRate: profWinRate, topTraders, topSetups },
  }
}

export default async function AdminDashboardPage() {
  const stats = await fetchAnalytics()
  const { users, revenue, signals, trades } = stats

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">AlgoSphere Quant — Platform Intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-green-100 text-green-700 text-xs font-bold px-3 py-1">LIVE</span>
          <span className="text-xs text-muted-foreground">{new Date().toLocaleString()}</span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total Users" value={String(users.totalUsers)} sub={`+${users.newLast7} this week`} color="blue" />
        <KpiCard label="Total Revenue" value={formatCurrency(revenue.totalRevenue)} sub={`${revenue.totalApproved} payments`} color="green" />
        <KpiCard label="Signal Win Rate" value={`${signals.winRate}%`} sub={`${signals.wins}W / ${signals.losses}L`} color="yellow" />
        <KpiCard label="Platform P&L" value={formatCurrency(trades.totalPnl)} sub={`${trades.winRate}% win rate`} color={trades.totalPnl >= 0 ? 'green' : 'red'} />
      </div>

      {/* Charts row */}
      <AdminCharts
        signupChart={users.signupChart}
        revenueChart={revenue.revenueChart}
        tierData={[
          { name: 'Free', value: users.byTier.free },
          { name: 'Starter', value: users.byTier.starter },
          { name: 'Premium', value: users.byTier.premium },
        ]}
        signalData={[
          { name: 'Active', value: signals.active },
          { name: 'Wins', value: signals.wins },
          { name: 'Losses', value: signals.losses },
        ]}
      />

      {/* 3-col analytics */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* User stats */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-semibold">User Breakdown</h2>
          {[
            { label: 'Free', value: users.byTier.free, color: 'bg-gray-400' },
            { label: 'Starter', value: users.byTier.starter, color: 'bg-blue-500' },
            { label: 'Premium', value: users.byTier.premium, color: 'bg-yellow-500' },
            { label: 'Trialing', value: users.trialing, color: 'bg-purple-500' },
            { label: 'New (30d)', value: users.newLast30, color: 'bg-green-500' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${row.color}`} />
                <span className="text-muted-foreground">{row.label}</span>
              </div>
              <span className="font-semibold">{row.value}</span>
            </div>
          ))}
        </div>

        {/* Signal stats */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Signal Analytics</h2>
          <div className="space-y-2">
            <StatRow label="Total signals" value={String(signals.total)} />
            <StatRow label="Active" value={String(signals.active)} />
            <StatRow label="Win rate" value={`${signals.winRate}%`} highlight={signals.winRate >= 60} />
            <div className="border-t border-border pt-2 mt-2">
              <p className="text-xs text-muted-foreground mb-2">Top pairs</p>
              {signals.topPairs.map(p => (
                <div key={p.pair} className="flex justify-between text-xs py-0.5">
                  <span className="font-medium">{p.pair}</span>
                  <span className="text-muted-foreground">{p.count} signals</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trade stats */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Trade Analytics</h2>
          <StatRow label="Total trades logged" value={String(trades.total)} />
          <StatRow label="Platform P&L" value={formatCurrency(trades.totalPnl)} highlight={trades.totalPnl >= 0} />
          <StatRow label="Win rate" value={`${trades.winRate}%`} />
          <div className="border-t border-border pt-2 mt-2">
            <p className="text-xs text-muted-foreground mb-2">Top setups</p>
            {trades.topSetups.map(s => (
              <div key={s.tag} className="flex justify-between text-xs py-0.5 capitalize">
                <span className="font-medium">{s.tag}</span>
                <span className="text-muted-foreground">{s.count} trades</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top traders leaderboard */}
      {trades.topTraders.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Profitability Leaderboard</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground text-left">
                  <th className="pb-2 pr-4">Rank</th>
                  <th className="pb-2 pr-4">User ID</th>
                  <th className="pb-2 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.topTraders.map((t, i) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 font-bold text-muted-foreground">#{i + 1}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{t.id}</td>
                    <td className={`py-2 text-right font-semibold ${t.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(t.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Revenue summary */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Revenue Summary</h2>
          {revenue.pending > 0 && (
            <a href="/admin/payments?status=pending_review" className="rounded-md bg-yellow-100 text-yellow-800 text-xs font-semibold px-3 py-1 hover:bg-yellow-200">
              {revenue.pending} pending review →
            </a>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><p className="text-2xl font-bold">{formatCurrency(revenue.totalRevenue)}</p><p className="text-xs text-muted-foreground mt-1">Total collected</p></div>
          <div><p className="text-2xl font-bold">{revenue.totalApproved}</p><p className="text-xs text-muted-foreground mt-1">Approved payments</p></div>
          <div><p className="text-2xl font-bold text-yellow-600">{revenue.pending}</p><p className="text-xs text-muted-foreground mt-1">Awaiting review</p></div>
        </div>
      </div>

      {/* System health */}
      <SystemHealth />

      {/* User table */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">User Management</h2>
        <UserTable />
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const borders: Record<string, string> = {
    blue: 'border-l-blue-500', green: 'border-l-green-500',
    yellow: 'border-l-yellow-500', red: 'border-l-red-500',
  }
  return (
    <div className={`rounded-xl border border-border bg-card p-5 border-l-4 ${borders[color] ?? 'border-l-primary'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  )
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${highlight === true ? 'text-green-600' : highlight === false ? 'text-red-600' : ''}`}>{value}</span>
    </div>
  )
}
