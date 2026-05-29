import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { Settings, Landmark, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import Logo from '@/components/brand/Logo'
import MobileNav from './MobileNav'
import UserMenu from './UserMenu'
import CommandPalette from './CommandPalette'
import CommandPaletteTrigger from './CommandPaletteTrigger'
// Refocus R7: NotificationBell deleted alongside social_notifications.
// A trader-intelligence notification bell (coach alerts, evaluation
// landed, etc.) will re-emerge on the new schema in a focused PR.

/**
 * Global command bar (LAYER 1).
 *  - LEFT:   hamburger (mobile) + brand lockup (mobile)
 *  - CENTER: the ⌘K global search — the "brain" of the product
 *  - RIGHT:  broker status/connect · admin · bell · settings · avatar
 *
 * No mode switch. Search is the primary entry; broker connection state is
 * always visible (and one click to fix) so "connect a broker" never
 * requires hunting through settings.
 */
export default async function TopBar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: profile }, { data: brokers }] = await Promise.all([
    supabase.from('profiles')
      .select('full_name, subscription_tier, account_type')
      .eq('id', user!.id).single(),
    supabase.from('broker_connections')
      .select('broker, status, is_live, is_testnet')
      .eq('user_id', user!.id),
  ])

  const admin = isAdmin(user!.email)

  // Always-visible broker state — the header truth for "can I trade live?".
  const conns = brokers ?? []
  const errored   = conns.find((b) => b.status === 'error')
  const liveBroker = conns.find((b) => b.status === 'connected' && b.is_live === true && b.is_testnet !== true)
  const connected = conns.find((b) => b.status === 'connected')
  const broker: { label: string; cls: string; dot: string; cta: boolean } =
    errored     ? { label: 'Reconnect broker', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300', dot: 'bg-rose-400', cta: true }
    : liveBroker ? { label: `Live · ${cap(liveBroker.broker)}`, cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', cta: false }
    : connected  ? { label: `Testnet · ${cap(connected.broker)}`, cls: 'border-blue-500/40 bg-blue-500/10 text-blue-300', dot: 'bg-blue-400', cta: false }
    :              { label: 'Connect broker', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300', dot: 'bg-amber-400', cta: true }

  return (
    <header
      className={
        'sticky top-0 z-30 grid h-14 grid-cols-[auto_1fr_auto] items-center gap-2 ' +
        'border-b border-border/70 glass px-3 md:px-6'
      }
    >
      <CommandPalette />

      {/* LEFT — mobile menu + compact brand */}
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav tier="vip" isAdmin={admin} />
        <Link href="/overview" aria-label="AlgoSphere Quant — home" className="flex min-w-0 items-center gap-1.5 md:hidden">
          <Logo size="xs" alt="" />
          <span className="hidden min-[390px]:inline truncate text-sm font-bold leading-none tracking-tight">
            <span className="text-gradient">AlgoSphere</span> <span className="text-foreground/80">Quant</span>
          </span>
        </Link>
      </div>

      {/* CENTER — the ⌘K brain (prominent, wide) */}
      <div className="flex items-center justify-center min-w-0">
        <div className="hidden w-full max-w-md md:block">
          <CommandPaletteTrigger />
        </div>
      </div>

      {/* RIGHT — broker status · admin · bell · settings · avatar */}
      <div className="flex items-center justify-end gap-1.5">
        <Link
          href="/brokers"
          className={cn(
            'hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors sm:inline-flex',
            broker.cls,
          )}
        >
          {broker.cta
            ? <Plug className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            : <span className={cn('h-1.5 w-1.5 rounded-full', broker.dot)} aria-hidden />}
          <span className="hidden lg:inline">{broker.label}</span>
          <Landmark className="h-3.5 w-3.5 lg:hidden" strokeWidth={1.75} aria-hidden />
        </Link>

        {admin && (
          <Link
            href="/admin/dashboard"
            className="hidden md:flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
            Admin
          </Link>
        )}
        <Link
          href="/settings"
          aria-label="Settings"
          className="hidden sm:inline-flex rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </Link>
        <UserMenu
          email={user!.email ?? ''}
          name={profile?.full_name ?? ''}
          tier={profile?.subscription_tier ?? 'free'}
        />
      </div>
    </header>
  )
}

function cap(s: string | null): string {
  if (!s) return 'Broker'
  return s.charAt(0).toUpperCase() + s.slice(1)
}
