import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isDemo, effectiveTierForFeatures, demoTier } from '@/lib/demo'
import { generateDemoSignals } from '@/lib/demo-data'
import type { Signal, SubscriptionTier } from '@/lib/types'
import SignalsFeed from './SignalsFeed'

export const metadata = { title: 'Intelligence Feed' }
export const dynamic = 'force-dynamic'

// Starter demo: signals delayed by 30 min so they feel realistic but lag the live feed
const STARTER_DEMO_DELAY_MIN = 30

export default async function SignalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = isAdmin(user!.email)

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user!.id)
    .single()

  const accountType = profile?.account_type
  const userTier = effectiveTierForFeatures(
    user!.email,
    (profile?.subscription_tier ?? 'free') as SubscriptionTier,
    accountType,
  )

  let signals: Signal[]
  if (isDemo(accountType)) {
    const tier = demoTier(accountType)!
    const delay = tier === 'starter' ? STARTER_DEMO_DELAY_MIN : 0
    signals = generateDemoSignals(user!.id, tier, 12, delay)
  } else {
    // Strategy-opacity boundary: this array is serialized into the RSC
    // payload shipped to the browser, so it must carry NO engine internals
    // (feature_snapshot, component sub-scores, engine_version, admin_notes,
    // created_by, strategy_id). Select only client-safe columns. SignalsFeed
    // renders none of the excluded fields, so this is behaviour-preserving.
    const { data } = await supabase
      .from('signals')
      .select(
        'id,pair,direction,entry_price,stop_loss,take_profit_1,take_profit_2,' +
        'take_profit_3,risk_reward,confidence_score,regime,session,status,result,' +
        'pips_gained,tier_required,lifecycle_state,published_at,invalidated_at,' +
        'tp1_hit_at,tp2_hit_at,tp3_hit_at,stopped_at',
      )
      .order('published_at', { ascending: false })
      .limit(50)
    signals = (data ?? []) as unknown as Signal[]
  }

  return (
    <SignalsFeed
      initialSignals={signals}
      userTier={userTier}
      userEmail={user!.email ?? ''}
      isAdmin={admin}
    />
  )
}
