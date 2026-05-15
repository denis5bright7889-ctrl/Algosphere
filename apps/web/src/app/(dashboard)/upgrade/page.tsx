import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import CryptoPaymentFlow from './CryptoPaymentFlow'
import PaymentNotes from '@/components/upgrade/PaymentNotes'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Upgrade' }

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  premium: 'Pro',
  vip: 'VIP',
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; plan?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user!.id)
    .single()

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('current_period_end, cancel_at_period_end, status')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { reason } = await searchParams
  const tier = profile?.subscription_tier ?? 'free'
  const admin = isAdmin(user?.email)
  const betaOpen = isBetaFreeAccessEnabled()
  const instantActivateMode = admin || betaOpen

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
        <div className="absolute inset-0 bg-gradient-mesh opacity-60 pointer-events-none" aria-hidden />
        <div className="relative text-center">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            Upgrade your plan
          </span>
          <h1 className="mt-4 text-2xl sm:text-4xl font-bold tracking-tight">
            Choose the perfect <span className="text-gradient">AI trading package</span>
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Three institutional-grade tiers. Pay with USDT TRC20 — activates after manual review.
          </p>
        </div>
      </div>

      {reason === 'trial_expired' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Your free trial has ended. Choose a plan below to continue accessing live signals and tools.
        </div>
      )}

      {/* Admin instant-activate banner */}
      {admin && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-bold tracking-wide uppercase text-xs mr-2">Admin mode</strong>
          Clicking any plan below will activate it instantly without payment (for QA / demos).
        </div>
      )}

      {/* Open-beta free-access banner — visible to all users when flag is on */}
      {!admin && betaOpen && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong className="font-bold tracking-wide uppercase text-xs mr-2">Closed beta</strong>
          Free plan access is enabled while we finalise the platform. Clicking any plan below will
          activate it instantly without payment.
        </div>
      )}

      {/* Current plan status */}
      {tier !== 'free' && (
        <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <p className="font-medium">
              Current plan:{' '}
              <span className="font-bold text-gradient">{TIER_LABELS[tier] ?? tier}</span>
              <span className="ml-2 text-muted-foreground capitalize">({profile?.subscription_status})</span>
            </p>
            {subscription?.current_period_end && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {subscription.cancel_at_period_end
                  ? `Access until ${formatDate(subscription.current_period_end)}`
                  : `Renews ${formatDate(subscription.current_period_end)}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Plan selection
          - instant-activate mode (admin or beta flag): clicking a card hits
            /demo/[plan] which server-side instantly grants the live plan.
          - normal mode: full CryptoPaymentFlow with USDT TRC20 instructions.
      */}
      {instantActivateMode ? (
        <div className="grid gap-5 md:grid-cols-3">
          {([
            { id: 'starter', price: 29,  features: ['Daily AI signals', 'Forex + Commodities', 'Risk dashboard', 'Telegram alerts'] },
            { id: 'premium', price: 99,  features: ['Everything in Starter', 'Crypto signals', 'WhatsApp alerts', 'Priority support'], badge: 'Most popular' },
            { id: 'vip',     price: 299, features: ['Everything in Pro', 'Copy-trading', 'Private Telegram', 'API access'],        badge: 'Institutional' },
          ] as const).map((p) => {
            const isPro = p.id === 'premium'
            const isVip = p.id === 'vip'
            const isCurrent = tier === p.id
            return (
              <a
                key={p.id}
                href={`/demo/${p.id}`}
                className={
                  'relative rounded-2xl border p-6 flex flex-col transition-all duration-300 hover:scale-[1.02] ' +
                  (isPro ? 'border-amber-500/40 bg-card shadow-glow-gold ' :
                   isVip ? 'border-amber-500/30 bg-gradient-to-b from-amber-500/[0.06] to-card hover:border-amber-500/50 hover:shadow-glow ' :
                   'border-border bg-card hover:border-amber-500/30 hover:shadow-card-lift')
                }
              >
                {'badge' in p && p.badge && (
                  <span className={
                    'absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold tracking-widest uppercase ' +
                    (isPro
                      ? 'bg-gradient-gold text-black shadow-glow-gold'
                      : 'border border-amber-500/40 bg-background text-amber-300')
                  }>
                    {p.badge}
                  </span>
                )}

                <h3 className={'text-lg font-bold tracking-tight ' + ((isPro || isVip) ? 'text-gradient' : '')}>
                  {TIER_LABELS[p.id]}
                </h3>
                <div className="mt-1 mb-4 flex items-end gap-1">
                  <span className={'text-3xl font-extrabold tabular-nums ' + ((isPro || isVip) ? 'text-gradient' : '')}>
                    ${p.price}
                  </span>
                  <span className="mb-0.5 text-sm text-muted-foreground">/month</span>
                </div>

                <ul className="flex-1 space-y-1.5 mb-5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className="text-amber-400 mt-0.5 shrink-0">✓</span>
                      <span className="text-foreground/85">{f}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="block rounded-md border border-border bg-muted/30 px-4 py-2.5 text-center text-sm font-semibold text-muted-foreground">
                    Current plan
                  </div>
                ) : (
                  <span className={
                    'block w-full text-center text-sm ' +
                    ((isPro || isVip) ? 'btn-premium' : 'btn-glass justify-center')
                  }>
                    Get {TIER_LABELS[p.id]}
                  </span>
                )}
              </a>
            )
          })}
        </div>
      ) : (
        <CryptoPaymentFlow currentTier={tier} />
      )}

      {/* Hide payment notes when instant-activate is on — they're not relevant */}
      {!instantActivateMode && <PaymentNotes />}
    </div>
  )
}
