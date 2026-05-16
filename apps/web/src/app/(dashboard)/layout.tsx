import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isDemo } from '@/lib/demo'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import DesktopSidebar from '@/components/dashboard/DesktopSidebar'
import TopBar from '@/components/dashboard/TopBar'
import MobileBottomNav from '@/components/dashboard/MobileBottomNav'
import DemoBanner from '@/components/demo/DemoBanner'

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
      <DesktopSidebar admin={admin} showUpgradePrompt={showUpgradePrompt} />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <DemoBanner accountType={profile?.account_type} />
        <main
          className={
            'flex-1 overflow-y-auto p-4 md:p-6 ' +
            // Clearance for the floating mobile bottom bar (~60px bar + gap + safe area)
            'pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-6'
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
