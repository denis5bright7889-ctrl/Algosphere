import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isDemo } from '@/lib/demo'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import RailNav from '@/components/dashboard/RailNav'
import TopBar from '@/components/dashboard/TopBar'
import MobileBottomNav from '@/components/dashboard/MobileBottomNav'
import DemoBanner from '@/components/demo/DemoBanner'
import LiveStatePanel from '@/components/dashboard/LiveStatePanel'
import MobileCommandFab from '@/components/dashboard/MobileCommandFab'
import { ChartModalProvider } from '@/components/charts'

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

  // LAUNCH PHASE — Pro / VIP are "Coming soon" so the free tier is
  // effectively the only product, and we don't want the 7-day trial
  // gate booting users out of their own product. The original logic
  // (commented below) is preserved so the trial-expiry gate can be
  // restored verbatim when Pro/VIP launch. demo / admin / canceled
  // continue to be respected via the layout/subscription checks
  // elsewhere; nothing about payment infrastructure is removed.
  //
  // Restore on Pro launch:
  //   const TRIAL_DAYS = 7
  //   const onFreeTier = profile?.subscription_tier === 'free'
  //   const trialAgeMs = profile?.created_at
  //     ? Date.now() - new Date(profile.created_at).getTime()
  //     : 0
  //   const trialElapsed = trialAgeMs > TRIAL_DAYS * 24 * 60 * 60 * 1000
  //   const isTrialExpired =
  //     !admin && !demo && !betaOpen && onFreeTier &&
  //     (profile?.subscription_status === 'canceled' || trialElapsed)
  //   const pathname = (await headers()).get('x-pathname') ?? ''
  //   const trialExempt =
  //     pathname.startsWith('/upgrade') || pathname.startsWith('/learn')
  //   if (isTrialExpired && !trialExempt) redirect('/upgrade?reason=trial_expired')
  // The headers() / redirect imports stay so the restore is one
  // uncomment away.
  void admin; void demo; void betaOpen   // keep the readers honest about why these still load

  return (
    <ChartModalProvider>
    <div className="flex min-h-screen bg-background">
      {/* Icon rail + hover flyout — compact, max canvas, nothing hidden
          (every route is one hover away; same NAV_GROUPS registry). */}
      <RailNav admin={admin} />

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

      {/* Right column — the always-on Live State Panel (xl+ screens) */}
      <LiveStatePanel />

      {/* Thumb-reachable command palette trigger — mobile */}
      <MobileCommandFab />

      {/* Mobile-only bottom tab bar — fixed, thumb-friendly */}
      <MobileBottomNav />
    </div>
    </ChartModalProvider>
  )
}
