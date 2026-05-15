import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const svc = db()
  const now = new Date()
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString()
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString()

  const [
    { data: profiles },
    { data: subscriptions },
    { data: payments },
    { data: signals },
    { data: journal },
    { data: authUsers },
  ] = await Promise.all([
    svc.from('profiles').select('id, subscription_tier, subscription_status, created_at'),
    svc.from('subscriptions').select('id, plan, status, current_period_end, created_at'),
    svc.from('crypto_payments').select('id, plan, amount_usd, status, created_at, reviewed_at'),
    svc.from('signals').select('id, pair, direction, status, result, tier_required, published_at'),
    svc.from('journal_entries').select('id, user_id, pnl, pips, pair, setup_tag, trade_date'),
    svc.from('profiles').select('id, created_at').gte('created_at', d30),
  ])

  const p = profiles ?? []
  const sub = subscriptions ?? []
  const pay = payments ?? []
  const sig = signals ?? []
  const trades = journal ?? []

  // --- User analytics ---
  const totalUsers = p.length
  const byTier = {
    free: p.filter(x => x.subscription_tier === 'free').length,
    starter: p.filter(x => x.subscription_tier === 'starter').length,
    premium: p.filter(x => x.subscription_tier === 'premium').length,
  }
  const trialing = p.filter(x => x.subscription_status === 'trialing').length
  const newLast7 = p.filter(x => x.created_at >= d7).length
  const newLast30 = p.filter(x => x.created_at >= d30).length

  // Daily signups (last 30 days)
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

  // --- Revenue analytics ---
  const approvedPayments = pay.filter(x => x.status === 'approved')
  const totalRevenue = approvedPayments.reduce((s, x) => s + (x.amount_usd ?? 0), 0)
  const pendingPayments = pay.filter(x => x.status === 'pending_review').length
  const revenueByMonth: Record<string, number> = {}
  approvedPayments.forEach(x => {
    const month = (x.reviewed_at ?? x.created_at)?.slice(0, 7)
    if (month) revenueByMonth[month] = (revenueByMonth[month] ?? 0) + (x.amount_usd ?? 0)
  })
  const revenueChart = Object.entries(revenueByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }))

  // --- Signal analytics ---
  const totalSignals = sig.length
  const activeSignals = sig.filter(x => x.status === 'active').length
  const closedSignals = sig.filter(x => x.status === 'closed')
  const wins = closedSignals.filter(x => x.result === 'win').length
  const losses = closedSignals.filter(x => x.result === 'loss').length
  const winRate = closedSignals.length ? Math.round((wins / closedSignals.length) * 100) : 0
  const pairCounts: Record<string, number> = {}
  sig.forEach(s => { pairCounts[s.pair] = (pairCounts[s.pair] ?? 0) + 1 })
  const topPairs = Object.entries(pairCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([pair, count]) => ({ pair, count }))

  // --- Trade / profitability analytics ---
  const totalTrades = trades.length
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const profitableTrades = trades.filter(t => (t.pnl ?? 0) > 0).length
  const platformWinRate = totalTrades ? Math.round((profitableTrades / totalTrades) * 100) : 0

  // Per-user P&L
  const userPnl: Record<string, number> = {}
  trades.forEach(t => {
    userPnl[t.user_id] = (userPnl[t.user_id] ?? 0) + (t.pnl ?? 0)
  })
  const topTraders = Object.entries(userPnl)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([userId, pnl]) => ({ userId: userId.slice(0, 8), pnl }))

  // Setup tag breakdown
  const setupCounts: Record<string, number> = {}
  trades.filter(t => t.setup_tag).forEach(t => {
    setupCounts[t.setup_tag!] = (setupCounts[t.setup_tag!] ?? 0) + 1
  })
  const topSetups = Object.entries(setupCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }))

  return NextResponse.json({
    users: { totalUsers, byTier, trialing, newLast7, newLast30, signupChart },
    revenue: { totalRevenue, pendingPayments, revenueChart, totalApproved: approvedPayments.length },
    signals: { totalSignals, activeSignals, wins, losses, winRate, topPairs },
    trades: { totalTrades, totalPnl, platformWinRate, profitableTrades, topTraders, topSetups },
  })
}
