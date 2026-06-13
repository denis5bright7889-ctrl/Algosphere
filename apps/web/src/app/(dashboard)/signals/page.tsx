import { createClient } from '@/lib/supabase/server'
import { isAdmin, canAccess } from '@/lib/admin'
import { redactLockedSignal } from '@/lib/signal-abstraction'
import { isDemo, effectiveTierForFeatures, demoTier } from '@/lib/demo'
import { generateDemoSignals } from '@/lib/demo-data'
import { getEngineStatus } from '@/lib/engine-client'
import type { Signal, SubscriptionTier } from '@/lib/types'
import SignalsFeed, { type EngineSnapshot } from './SignalsFeed'
import type { TradeBroker } from '@/components/dashboard/PlaceTradeButton'
import { DEFAULT_SETTINGS, type AutoTradingSettings } from '@/lib/auto-trading'

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

  // Connected brokers power the per-signal "Place Trade" button. Only
  // client-safe columns (NO *_enc credentials) cross to the browser.
  const { data: brokerRows } = await supabase
    .from('broker_connections')
    .select('id, broker, label, is_live, is_testnet, status')
    .eq('user_id', user!.id)
    .eq('status', 'connected')
    .order('is_default', { ascending: false })
  const brokers = (brokerRows ?? []) as TradeBroker[]

  // Auto-trading settings — caller-self via RLS. Missing row falls back
  // to the safe defaults (enabled=false, no symbols allowed).
  const { data: autoRow } = await supabase
    .from('user_auto_trading_settings')
    .select('*')
    .eq('user_id', user!.id)
    .maybeSingle()
  const autoSettings: AutoTradingSettings = autoRow
    ? (autoRow as AutoTradingSettings)
    : {
        user_id:               user!.id,
        ...DEFAULT_SETTINGS,
        updated_at:            new Date().toISOString(),
        enabled_at:            null,
        total_auto_executions: 0,
      }

  const accountType = profile?.account_type
  const userTier = effectiveTierForFeatures(
    user!.email,
    (profile?.subscription_tier ?? 'free') as SubscriptionTier,
    accountType,
  )

  let signals: Signal[]
  let engineSnapshot: EngineSnapshot = null

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
    const [signalsRes, engineRes, latestRes] = await Promise.all([
      supabase
        .from('signals')
        .select(
          'id,pair,direction,entry_price,stop_loss,take_profit_1,take_profit_2,' +
          'take_profit_3,risk_reward,confidence_score,regime,session,status,result,' +
          'pips_gained,tier_required,lifecycle_state,published_at,invalidated_at,' +
          'tp1_hit_at,tp2_hit_at,tp3_hit_at,stopped_at',
        )
        .order('published_at', { ascending: false })
        .limit(50),
      // Engine pulse — used to explain WHY the feed might be empty
      // ("engine paused" vs "no provider configured" vs "engine running,
      // no signals met confidence threshold this scan").
      getEngineStatus(),
      // Latest published signal across the platform (not just to this
      // viewer) so we can show "last signal: 3h ago" honestly. Public
      // by RLS.
      supabase
        .from('signals')
        .select('published_at')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    signals = (signalsRes.data ?? []) as unknown as Signal[]
    engineSnapshot = {
      ok:       engineRes.ok,
      enabled:  engineRes.ok ? engineRes.data.enabled : null,
      provider: engineRes.ok ? engineRes.data.provider : null,
      symbols:  engineRes.ok ? engineRes.data.symbols  : null,
      lastTick: engineRes.ok ? engineRes.data.time     : null,
      error:    engineRes.ok ? null : engineRes.error,
      lastSignalAt: latestRes.data?.published_at ?? null,
    }
  }

  // Authoritative tier gate: strip the edge (entry/SL/TP/RR/confidence) from
  // signals this viewer can't access BEFORE it reaches the browser. Uses the
  // same predicate SignalCard renders with, so the locked-card + upsell UX is
  // unchanged — only the underlying numbers stop shipping in the RSC payload.
  const email = user!.email ?? ''
  signals = signals.map(s => redactLockedSignal(s, canAccess(email, userTier, s.tier_required)))

  return (
    <SignalsFeed
      initialSignals={signals}
      userTier={userTier}
      userEmail={user!.email ?? ''}
      isAdmin={admin}
      engine={engineSnapshot}
      brokers={brokers}
      autoSettings={autoSettings}
    />
  )
}
