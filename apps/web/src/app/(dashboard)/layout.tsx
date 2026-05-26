import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isDemo } from '@/lib/demo'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import DesktopSidebar from '@/components/dashboard/DesktopSidebar'
import TopBar from '@/components/dashboard/TopBar'
import MobileBottomNav from '@/components/dashboard/MobileBottomNav'
import DemoBanner from '@/components/demo/DemoBanner'
import InsightDrawer from '@/components/dashboard/InsightDrawer'
import MobileCommandFab from '@/components/dashboard/MobileCommandFab'

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

  // Routes that MUST stay reachable after the trial expires:
  //   /upgrade — the conversion path itself. It lives inside this
  //     group, so without this exemption a trial-expired user is
  //     redirected to /upgrade, which re-runs this layout, which
  //     redirects again → infinite loop. The page even has a
  //     `reason=trial_expired` branch that was previously unreachable.
  //   /learn  — Education hub kept open as a beginner-acquisition
  //     funnel (free learning access survives trial expiry by design).
  const pathname = (await headers()).get('x-pathname') ?? ''
  const trialExempt =
    pathname.startsWith('/upgrade') || pathname.startsWith('/learn')

  if (isTrialExpired && !trialExempt) redirect('/upgrade?reason=trial_expired')

  // Upgrade prompt: skip for admin, anyone already on Pro/VIP (real or demo),
  // and skip entirely during open beta (everyone is effectively VIP).
  const topTier =
    profile?.subscription_tier === 'premium' || profile?.subscription_tier === 'vip'
  const topDemo =
    profile?.account_type === 'demo_premium' || profile?.account_type === 'demo_vip'
  const showUpgradePrompt = !admin && !betaOpen && !topTier && !topDemo

  // Effective nav tier — admins/beta see everything; demo tiers map to
  // their real-feature equivalent; otherwise the stored subscription.
  const navTier: 'free' | 'starter' | 'premium' | 'vip' =
    admin || betaOpen
      ? 'vip'
      : profile?.account_type === 'demo_vip'
      ? 'vip'
      : profile?.account_type === 'demo_premium'
      ? 'premium'
      : (['free', 'starter', 'premium', 'vip'] as const).includes(
          (profile?.subscription_tier ?? 'free') as 'free' | 'starter' | 'premium' | 'vip',
        )
      ? ((profile?.subscription_tier ?? 'free') as 'free' | 'starter' | 'premium' | 'vip')
      : 'free'

  return (
    <div className="flex min-h-screen bg-background">
      <DesktopSidebar admin={admin} showUpgradePrompt={showUpgradePrompt} tier={navTier} />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <DemoBanner accountType={profile?.account_type} />
        <main
          className={
            // Tighter mobile gutters (12px) so dashboard pages that add their
            // own px-4 wrapper don't double-pad and waste horizontal space
            // on phones. Desktop unchanged.
            'flex-1 overflow-y-auto px-3 py-4 md:p-6 ' +
            // Clearance for the floating mobile bottom bar (~60px bar + gap + safe area)
            'pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-6'
          }
        >
          {children}
        </main>
      </div>

      {/* Contextual insight rail — desktop */}
      <InsightDrawer />

      {/* Thumb-reachable command palette trigger — mobile */}
      <MobileCommandFab />

      {/* Mobile-only bottom tab bar — fixed, thumb-friendly */}
      <MobileBottomNav />
    </div>
  )
}
