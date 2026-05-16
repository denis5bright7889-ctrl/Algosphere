import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import { verificationBadge, type VerificationTier } from '@/lib/leaderboard'
import VerificationApplyForm from './VerificationApplyForm'

export const metadata = { title: 'Verification — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function VerificationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()

  const [
    { data: profile },
    { count: tradeCount },
    { data: distinct },
    { count: liveSignals },
    { data: verif },
  ] = await Promise.all([
    svc.from('profiles')
      .select('public_profile, public_handle')
      .eq('id', user.id)
      .single(),
    svc.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    svc.from('journal_entries')
      .select('trade_date')
      .eq('user_id', user.id),
    svc.from('signals')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .in('lifecycle_state', ['tp1_hit','tp2_hit','tp3_hit','stopped','breakeven']),
    svc.from('trader_verifications')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const activeDays   = new Set((distinct ?? []).map((r: any) => r.trade_date)).size
  const hasProfile   = !!(profile?.public_profile && profile?.public_handle)
  const currentTier  = (verif?.tier ?? 'none') as VerificationTier
  const appStatus    = verif?.application_status ?? 'idle'

  const tiers = [
    {
      key: 'basic',
      label: 'Basic',
      icon: '☑️',
      description: 'Auto-granted. Earns a Basic badge on your profile.',
      requirements: [
        { label: 'Public trader profile',  met: hasProfile,             current: hasProfile ? '✓' : '—' },
        { label: '20+ trades logged',      met: (tradeCount ?? 0) >= 20, current: `${tradeCount ?? 0}` },
        { label: '30+ active trading days', met: activeDays >= 30,       current: `${activeDays}` },
      ],
    },
    {
      key: 'verified',
      label: 'Verified',
      icon: '✅',
      description: 'Admin-reviewed. Broker statement required. 3–5 day review.',
      requirements: [
        { label: 'Reach Basic tier',        met: currentTier !== 'none' && currentTier !== 'basic'
                                                  ? true : currentTier === 'basic',
                                            current: currentTier !== 'none' ? '✓' : '—' },
        { label: '20+ published live signals', met: (liveSignals ?? 0) >= 20,
                                            current: `${liveSignals ?? 0}` },
        { label: 'Submit broker statement', met: !!verif?.broker_statement_url,
                                            current: verif?.broker_statement_url ? '✓' : 'Required' },
      ],
    },
    {
      key: 'elite',
      label: 'Elite',
      icon: '🏆',
      description: 'Committee review. 6+ months live record with Sharpe ≥ 1.5.',
      requirements: [
        { label: 'Verified status',         met: currentTier === 'verified' || currentTier === 'elite',
                                            current: currentTier === 'verified' || currentTier === 'elite' ? '✓' : '—' },
        { label: '6+ months live trading',  met: false, current: '0 mo' },
        { label: 'Sharpe ratio ≥ 1.5',      met: false, current: 'pending' },
      ],
    },
  ] as const

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Trader <span className="text-gradient">Verification</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Build credibility and unlock platform features through verified track record.
        </p>
      </header>

      {/* Current tier */}
      <div className="rounded-2xl border border-border bg-card p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Current Tier
            </p>
            <div className="flex items-center gap-2 mt-1">
              <CurrentBadge tier={currentTier} />
              {appStatus === 'pending_verified' && (
                <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                  ⏳ Verified review in progress
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tier breakdown */}
      <div className="space-y-3">
        {tiers.map(t => {
          const allMet = t.requirements.every(r => r.met)
          const isCurrent = currentTier === t.key
          const reached = (() => {
            if (currentTier === 'elite') return true
            if (currentTier === 'verified' && t.key !== 'elite') return true
            if (currentTier === 'basic' && t.key === 'basic') return true
            return false
          })()
          return (
            <div
              key={t.key}
              className={cn(
                'rounded-2xl border p-5 transition-colors',
                reached
                  ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                  : isCurrent || allMet
                    ? 'border-amber-500/40 bg-amber-500/[0.04]'
                    : 'border-border bg-card',
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-base font-bold">
                    {t.icon} {t.label}
                    {reached && (
                      <span className="ml-2 text-[10px] font-bold text-emerald-300 uppercase">
                        ✓ Unlocked
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                </div>
              </div>

              <ul className="space-y-1.5 mb-3">
                {t.requirements.map(r => (
                  <li
                    key={r.label}
                    className={cn(
                      'flex items-center justify-between text-xs',
                      r.met ? 'text-emerald-300' : 'text-muted-foreground',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span>{r.met ? '✓' : '○'}</span>
                      {r.label}
                    </span>
                    <span className="tabular-nums">{r.current}</span>
                  </li>
                ))}
              </ul>

              {t.key === 'verified' && allMet && !reached && appStatus === 'idle' && (
                <VerificationApplyForm />
              )}

              {t.key === 'elite' && currentTier === 'verified' && allMet && (
                <p className="text-xs text-amber-300">
                  Elite candidacy is committee-reviewed. We&apos;ll reach out when eligible.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Why verify?</strong> Verified traders rank higher
          on the leaderboard (+25 score points for Basic, +65 for Verified, +100 for Elite),
          earn higher subscriber trust, and unlock priority support.
        </p>
      </div>
    </div>
  )
}

function CurrentBadge({ tier }: { tier: VerificationTier }) {
  const badge = verificationBadge(tier)
  if (!badge) {
    return (
      <span className="rounded-full border border-border bg-background/50 px-3 py-1 text-xs font-bold text-muted-foreground">
        Unverified
      </span>
    )
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold',
      badge.cls,
    )}>
      {badge.icon} {badge.label}
    </span>
  )
}
