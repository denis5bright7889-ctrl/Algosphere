import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { isBetaFreeAccessEnabled } from '@/lib/beta-access'
import { Settings } from 'lucide-react'
import LiveMarketPill from '@/components/ui/LiveMarketPill'
import Logo from '@/components/brand/Logo'
import MobileNav from './MobileNav'
import UserMenu from './UserMenu'
import CommandPalette from './CommandPalette'
import CommandPaletteTrigger from './CommandPaletteTrigger'
import NotificationBell from '@/components/social/NotificationBell'

/**
 * Three-column top bar.
 *  - LEFT: hamburger (mobile) + brand lockup (mobile) / search (desktop)
 *  - CENTER: live market status indicator (shorter "LIVE" on small screens)
 *  - RIGHT: admin link (desktop), notification bell, settings, user menu
 */
export default async function TopBar() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, subscription_tier, account_type')
    .eq('id', user!.id)
    .single()

  const admin = isAdmin(user!.email)
  const betaOpen = isBetaFreeAccessEnabled()

  // Same effective nav tier the dashboard layout computes — keeps the
  // mobile drawer's role-based filtering identical to the desktop rail.
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
    <header
      className={
        'sticky top-0 z-30 grid h-14 grid-cols-[auto_1fr_auto] items-center gap-2 ' +
        'border-b border-border/70 glass px-3 md:px-6'
      }
    >
      <CommandPalette />

      {/* LEFT — mobile: menu + compact brand · desktop: search */}
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav tier={navTier} isAdmin={admin} />
        <a
          href="/overview"
          aria-label="AlgoSphere Quant — home"
          className="flex min-w-0 items-center gap-1.5 md:hidden"
        >
          <Logo size="xs" alt="" />
          {/* Wordmark dropped on very narrow screens so the bar never
              congests; logo + bottom-nav still carry the brand. */}
          <span className="hidden min-[390px]:inline truncate text-sm font-bold leading-none tracking-tight">
            <span className="text-gradient">AlgoSphere</span>
            <span className="ml-1 text-foreground/80">Quant</span>
          </span>
        </a>
        <div className="hidden md:block">
          <CommandPaletteTrigger />
        </div>
      </div>

      {/* CENTER — market status (compact on mobile) */}
      <div className="flex items-center justify-center min-w-0">
        <span className="hidden sm:inline">
          <LiveMarketPill />
        </span>
        <span className="sm:hidden">
          <LiveMarketPill compact />
        </span>
      </div>

      {/* RIGHT — admin · bell · settings · avatar */}
      <div className="flex items-center justify-end gap-1.5">
        {admin && (
          <a
            href="/admin/dashboard"
            className="hidden md:flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
            Admin
          </a>
        )}
        <NotificationBell />
        {/* Redundant on mobile (Settings is in the drawer + user menu) */}
        <a
          href="/settings"
          aria-label="Settings"
          className="hidden sm:inline-flex rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </a>
        <UserMenu
          email={user!.email ?? ''}
          name={profile?.full_name ?? ''}
          tier={profile?.subscription_tier ?? 'free'}
        />
      </div>
    </header>
  )
}
