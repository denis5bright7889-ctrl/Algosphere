'use client'

/**
 * IconRail — the workstation left rail (LAYER 2: contextual sidebar).
 *
 * Mode-aware. The rail no longer shows one flat list of everything — it
 * shows ONLY the routes for the active mode (Trade / Analyze / Research /
 * Community), resolved from the URL via `modeForPath`. Switching mode
 * (ModeSwitcher in the top bar) swaps the rail's contents wholesale, so
 * the user's cognitive context stays isolated to one intent at a time.
 *
 *   • Per-mode destinations — hover → label tooltip; active route → gold
 *     accent bar; tier-aware (items above the viewer's tier drop out —
 *     page-level gates unchanged).
 *   • Footer: ⌘K search (everything, cross-mode), Settings, Admin.
 *
 * Nothing is orphaned: off-mode routes are one ⌘K away, and the mobile
 * drawer still carries the full nav.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, UserCog, Settings2, type LucideIcon } from 'lucide-react'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import type { Tier } from './nav'
import { MODES, modeForPath, getMode, type ModeRoute } from '@/lib/modes'

const TIER_RANK: Record<Tier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

function RailLink({ href, label, icon: Icon, active }: {
  href: string; label: string; icon: LucideIcon; active: boolean
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {active && (
        <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
      )}
      <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.1 : 1.75} aria-hidden />
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-[calc(100%+0.5rem)] z-50 whitespace-nowrap rounded-md',
          'border border-border/70 bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground shadow-xl',
          'opacity-0 -translate-x-1 transition-all duration-150',
          'group-hover:opacity-100 group-hover:translate-x-0',
        )}
      >
        {label}
      </span>
    </Link>
  )
}

export default function IconRail({
  admin = false,
  tier = 'free',
}: {
  admin?: boolean
  tier?: Tier
}) {
  const pathname = usePathname() ?? ''
  const rank = TIER_RANK[tier] ?? 0

  const activeMode = modeForPath(pathname)
  const mode = getMode(activeMode)
  const ModeIcon = mode.icon
  const items: ModeRoute[] = mode.items.filter(
    (i) => admin || !i.minTier || rank >= TIER_RANK[i.minTier],
  )

  return (
    <aside className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-border/70 glass-strong py-3">
      {/* Brand mark */}
      <Link href="/overview" aria-label="AlgoSphere Quant — home" className="mb-2 flex h-10 w-10 items-center justify-center">
        <Logo size="sm" alt="" priority />
      </Link>

      {/* Active-mode badge — anchors which context the rail is showing */}
      <div
        className="mb-2 flex h-7 w-11 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"
        title={`${mode.label} mode — ${mode.blurb}`}
      >
        <ModeIcon className="h-4 w-4" strokeWidth={2} aria-hidden />
      </div>

      {/* Per-mode destinations */}
      <nav className="flex flex-1 flex-col items-center gap-1.5" aria-label={`${mode.label} navigation`}>
        {items.map((item) => (
          <RailLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(pathname, item.href)}
          />
        ))}
      </nav>

      {/* Footer — cross-mode search, settings, admin */}
      <div className="mt-2 flex flex-col items-center gap-1.5 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          aria-label="Search everything (⌘K)"
          className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-accent/50 hover:text-foreground"
        >
          <Search className="h-[20px] w-[20px]" strokeWidth={1.75} aria-hidden />
          <span
            role="tooltip"
            className="pointer-events-none absolute left-[calc(100%+0.5rem)] z-50 whitespace-nowrap rounded-md border border-border/70 bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground shadow-xl opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
          >
            Search · ⌘K
          </span>
        </button>

        <RailLink href="/settings" label="Settings" icon={UserCog} active={isActive(pathname, '/settings')} />

        {admin && (
          <Link
            href="/admin/dashboard"
            aria-label="Admin Dashboard"
            className={cn(
              'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all',
              pathname.startsWith('/admin')
                ? 'bg-red-500/15 text-red-300'
                : 'text-red-400/70 hover:bg-red-500/10 hover:text-red-300',
            )}
          >
            <Settings2 className="h-[20px] w-[20px]" strokeWidth={1.75} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-[calc(100%+0.5rem)] z-50 whitespace-nowrap rounded-md border border-red-500/40 bg-popover px-2.5 py-1.5 text-xs font-medium text-red-200 shadow-xl opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
            >
              Admin Dashboard
            </span>
          </Link>
        )}
      </div>
    </aside>
  )
}
