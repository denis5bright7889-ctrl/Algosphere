import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export interface EarningsSummary {
  total_accrued:  number
  total_approved: number
  total_paid:     number
  pending_payout: number
  by_type: {
    subscription_fee: number
    profit_share:     number
    tip:              number
  }
  subscribers_count: number
  copy_followers:    number
  top_strategy: {
    id:        string
    name:      string
    revenue:   number
  } | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Earnings rollups by status
  const { data: earnings } = await supabase
    .from('creator_earnings')
    .select('earning_type, creator_usd, status')
    .eq('creator_id', user.id)

  const rows = earnings ?? []
  const sumBy = (filter: (r: typeof rows[number]) => boolean) =>
    rows.filter(filter).reduce((s, r) => s + Number(r.creator_usd ?? 0), 0)

  const summary: EarningsSummary = {
    total_accrued:  sumBy(r => r.status === 'accrued'),
    total_approved: sumBy(r => r.status === 'approved'),
    total_paid:     sumBy(r => r.status === 'paid'),
    pending_payout: sumBy(r => r.status === 'accrued' || r.status === 'approved'),
    by_type: {
      subscription_fee: sumBy(r => r.earning_type === 'subscription_fee'),
      profit_share:     sumBy(r => r.earning_type === 'profit_share'),
      tip:              sumBy(r => r.earning_type === 'tip'),
    },
    subscribers_count: 0,
    copy_followers:    0,
    top_strategy:      null,
  }

  // 2. Strategy aggregates
  const { data: strategies } = await supabase
    .from('published_strategies')
    .select('id, name, subscribers_count, copy_followers_count, total_revenue_usd')
    .eq('creator_id', user.id)
    .eq('status', 'active')

  if (strategies && strategies.length > 0) {
    summary.subscribers_count = strategies.reduce((s, x) => s + (x.subscribers_count ?? 0), 0)
    summary.copy_followers    = strategies.reduce((s, x) => s + (x.copy_followers_count ?? 0), 0)
    const top = strategies.reduce((a, b) =>
      (a.total_revenue_usd ?? 0) > (b.total_revenue_usd ?? 0) ? a : b
    )
    summary.top_strategy = {
      id:      top.id,
      name:    top.name,
      revenue: Number(top.total_revenue_usd ?? 0),
    }
  }

  // 3. Recent earnings (last 20)
  const { data: recent } = await supabase
    .from('creator_earnings')
    .select(`
      id, earning_type, gross_usd, creator_usd, status,
      period_start, period_end, created_at, paid_at,
      published_strategies ( name )
    `)
    .eq('creator_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    summary,
    recent: recent ?? [],
  })
}
