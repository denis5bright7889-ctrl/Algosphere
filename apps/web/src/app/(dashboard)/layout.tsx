import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isDemo } from '@/lib/demo'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import Sidebar from '@/components/dashboard/Sidebar'
import TopBar from '@/components/dashboard/TopBar'
import MobileBottomNav from '@/components/dashboard/MobileBottomNav'
import DemoBanner from '@/components/demo/DemoBanner'
import Logo from '@/components/brand/Logo'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = isAdmin(user.email)

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, account_type, created_at')
    .eq('id', user.id)
    .single()

  const demo = isDemo(profile?.account_type)
  const betaOpen = isBetaFreeAccessEnabled()

  // 7-day free trial: a free user is locked once 7 days have elapsed since
  // signup (deterministic from created_at — no cron needed), OR if their
  // status was explicitly canceled. Admin / demo / open-beta bypass.
  const TRIAL_DAYS = 7
  const onFreeTier = profile?.subscription_tier === 'free'
  const trialAgeMs = profile?.created_at
    ? Date.now() - new Date(profile.created_at).getTime()
    : 0
  const trialElapsed = trialAgeMs > TRIAL_DAYS * 24 * 60 * 60 * 1000
  const isTrialExpired =
    !admin &&
    !demo &&
    !betaOpen &&
    onFreeTier &&
    (profile?.subscription_status === 'canceled' || trialElapsed)

  if (isTrialExpired) redirect('/upgrade?reason=trial_expired')

  // Upgrade prompt: skip for admin, anyone already on Pro/VIP (real or demo),
  // and skip entirely during open beta (everyone is effectively VIP).
  const topTier =
    profile?.subscription_tier === 'premium' || profile?.subscription_tier === 'vip'
  const topDemo =
    profile?.account_type === 'demo_premium' || profile?.account_type === 'demo_vip'
  const showUpgradePrompt = !admin && !betaOpen && !topTier && !topDemo

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-md py-6">
        <div className="px-4 mb-6">
          <a href="/overview" className="flex items-center gap-2 group">
            <Logo size="sm" alt="" priority />
            <span className="text-base font-bold tracking-tight">
              <span className="text-gradient">AlgoSphere</span>{' '}
              <span className="text-foreground/90">Quant</span>
            </span>
          </a>
          {admin && (
            <span className="mt-2 inline-block rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-red-400 uppercase">
              Admin
            </span>
          )}
        </div>
        <Sidebar />
        {admin && (
          <div className="mt-2 px-4">
            <a
              href="/admin/dashboard"
              className="block rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs font-semibold text-red-300 transition-all hover:bg-red-500/20 hover:shadow-glow-red"
            >
              Admin Dashboard
            </a>
          </div>
        )}
        {showUpgradePrompt && (
          <div className="mt-auto px-4 pt-4">
            <a
              href="/upgrade"
              className="btn-premium w-full !text-xs"
            >
              Upgrade to Pro
            </a>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <DemoBanner accountType={profile?.account_type} />
        <main
          className={
            'flex-1 overflow-y-auto p-4 md:p-6 ' +
            // Leave room for the fixed mobile bottom nav (≈56px tap + safe area)
            'pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-6'
          }
        >
          {children}
        </main>
      </div>

      {/* Mobile-only bottom tab bar — fixed, thumb-friendly */}
      <MobileBottomNav />
    </div>
  )
}
