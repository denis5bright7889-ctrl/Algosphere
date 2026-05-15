import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { effectiveTierForFeatures } from '@/lib/demo'
import { tierIncludes } from '@/lib/entitlements'
import type { SubscriptionTier } from '@/lib/types'
import TierGate from '@/components/algo/TierGate'
import ApiKeyManager from './ApiKeyManager'

export const metadata = { title: 'API Access' }

export default async function ApiKeysPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id)
    .single()

  const tier = effectiveTierForFeatures(
    user.email,
    (profile?.subscription_tier ?? 'free') as SubscriptionTier,
    profile?.account_type,
  )
  const hasApi = tierIncludes(tier, 'vip')

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
        <div className="absolute inset-0 bg-gradient-mesh opacity-60 pointer-events-none" aria-hidden />
        <div className="relative">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            VIP · Institutional
          </span>
          <h1 className="mt-3 text-xl sm:text-3xl font-bold tracking-tight">
            <span className="text-gradient">API</span> Access
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programmatic access to signals & analytics — Bearer-authenticated, rate-limited per key.
          </p>
        </div>
      </div>

      {hasApi ? (
        <ApiKeyManager />
      ) : (
        <TierGate requiredTier="vip" userTier={tier} upgradeHref="/upgrade" blurContent={false}>
          <div />
        </TierGate>
      )}
    </div>
  )
}
