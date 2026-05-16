import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Per-tier API quotas (calls/month included before overage billing)
const TIER_QUOTA: Record<string, number> = {
  free:    0,
  starter: 0,
  premium: 10_000,
  vip:     100_000,
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', user.id)
    .single()

  const tier  = profile?.subscription_tier ?? 'free'
  const quota = TIER_QUOTA[tier] ?? 0
  const month = new Date().toISOString().slice(0, 7)

  const { data: meter } = await supabase
    .from('api_usage_meter')
    .select('calls, overage_calls, overage_billed_usd')
    .eq('user_id', user.id)
    .eq('period_month', month)
    .maybeSingle()

  const calls = meter?.calls ?? 0
  return NextResponse.json({
    tier,
    period:        month,
    quota,
    calls,
    remaining:     Math.max(0, quota - calls),
    overage_calls: meter?.overage_calls ?? 0,
    overage_billed_usd: Number(meter?.overage_billed_usd ?? 0),
    usage_pct:     quota > 0 ? Math.min(100, Math.round((calls / quota) * 100)) : 0,
  })
}
