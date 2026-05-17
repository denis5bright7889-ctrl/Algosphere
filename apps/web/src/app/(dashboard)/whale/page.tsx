import { redirect } from 'next/navigation'
import { Waves } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { effectiveTierForFeatures } from '@/lib/demo'
import { tokenScreener, isNansenConfigured, NansenError, type NansenToken } from '@/lib/nansen'
import TierGate from '@/components/algo/TierGate'
import type { SubscriptionTier } from '@/lib/types'
import WhaleClient from './WhaleClient'

export const metadata = { title: 'Whale Analytics' }
export const dynamic = 'force-dynamic'

export default async function WhalePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id).single()
  const rawTier  = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  // effectiveTierForFeatures bakes in admin / beta / demo bypass so the
  // gate, the SSR seed and the API route all agree on access.
  const tier = effectiveTierForFeatures(user.email, rawTier, profile?.account_type)
  const premiumish = tier === 'premium' || tier === 'vip'

  // Best-effort SSR seed — premium-gated. Free users get the upsell card
  // without ever calling Nansen.
  let initial: NansenToken[] = []
  let unavailable: string | null = null
  if (premiumish) {
    if (!isNansenConfigured()) {
      unavailable = 'Whale analytics is not configured on this deployment.'
    } else {
      try {
        initial = await tokenScreener({ timeframe: '24h', orderBy: 'buy_volume', direction: 'DESC', limit: 50 })
      } catch (e) {
        unavailable = e instanceof NansenError ? e.message : 'Failed to load Nansen data.'
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 animate-fade-in">
      <header>
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight">
          <Waves className="h-5 w-5 text-amber-300" strokeWidth={1.75} aria-hidden />
          Whale <span className="text-gradient">Analytics</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Smart-money flows across Ethereum, Solana and Base — powered by Nansen. Tracks where
          on-chain whales are buying right now.
        </p>
      </header>

      <TierGate requiredTier="premium" userTier={tier} upgradeHref="/upgrade" blurContent={false}>
        <WhaleClient initial={initial} initialError={unavailable} />
      </TierGate>
    </div>
  )
}
