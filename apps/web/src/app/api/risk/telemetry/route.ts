import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { effectiveTierForFeatures } from '@/lib/demo'
import type { SubscriptionTier } from '@/lib/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id)
    .single()

  const tier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  // Pro AND VIP unlock the institutional risk panel (demo Pro too — simulated
  // equity). Real-money operator actions are gated separately in
  // /api/risk/reset-lock + /emergency-flatten.
  const effective = effectiveTierForFeatures(user.email, tier, profile?.account_type)
  const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }
  if ((TIER_RANK[effective] ?? 0) < TIER_RANK.premium) {
    return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 })
  }

  const engineUrl = process.env.NEXT_PUBLIC_SIGNAL_ENGINE_API_URL
  if (!engineUrl) {
    return NextResponse.json({ error: 'Signal engine not configured' }, { status: 503 })
  }

  try {
    const res = await fetch(`${engineUrl}/api/v1/risk/telemetry`, { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Engine returned ${res.status}` }, { status: 502 })
    }
    const data = await res.json()
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Engine unreachable' },
      { status: 502 }
    )
  }
}
