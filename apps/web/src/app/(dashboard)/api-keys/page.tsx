/**
 * /api-keys — programmatic access management (VIP / Institutional).
 *
 * Tier-gated with the standard <TierLock> primitive. SAFETY: the API
 * key manager is a client island that lists / mints secrets, so it
 * MUST NOT render to non-VIP users — TierLock here wraps a stub
 * preview, never the real <ApiKeyManager>. Lower tiers see the
 * institutional surface chrome + an upgrade card; VIP gets the
 * unaltered manager.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { tierIncludes } from '@/lib/entitlements'
import { getEffectiveTier } from '@/lib/tier-resolver'
import TierLock from '@/components/tier/TierLock'
import ApiKeyManager from './ApiKeyManager'

export const metadata = { title: 'API Access' }
export const dynamic = 'force-dynamic'

export default async function ApiKeysPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tier } = await getEffectiveTier()
  const hasApi = tierIncludes(tier, 'vip')

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header sits OUTSIDE TierLock — always-visible advertising for
          the institutional tier (this is the "make it visible to drive
          upgrades" line of the brief). */}
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
        <TierLock minTier="vip" tier={tier} from="/api-keys">
          <ApiKeysSkeleton />
        </TierLock>
      )}
    </div>
  )
}

/**
 * Visual stand-in for the real API key manager. ZERO real data and no
 * client island that talks to the keys API — purely cosmetic chrome
 * that the lock overlay sits on top of. Critically, this is rendered
 * INSTEAD OF <ApiKeyManager> for non-VIP users so no key bytes ever
 * reach a locked viewer's browser.
 */
function ApiKeysSkeleton() {
  const rows = [
    { name: 'production-trader-bot',  perms: 'signals:read, account:read', prefix: 'algo_live_••••' },
    { name: 'backtest-research-key',  perms: 'signals:read',               prefix: 'algo_live_••••' },
    { name: 'mt5-bridge-vps',         perms: 'signals:read, execution:write', prefix: 'algo_live_••••' },
  ]
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border/60 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
        Active API Keys
      </div>
      <div className="divide-y divide-border/40">
        {rows.map((r) => (
          <div key={r.name} className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{r.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{r.perms}</p>
            </div>
            <code className="font-mono text-[11px] text-muted-foreground tabular-nums">{r.prefix}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
