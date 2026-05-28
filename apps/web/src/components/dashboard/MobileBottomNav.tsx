'use client'

/**
 * Mobile bottom nav — the mode system on touch (mandatory per spec).
 *
 * Five tabs: Trade · Analyze · Research · Community · Account. The first
 * four mirror the desktop ModeSwitcher (same `MODES` registry, so they
 * never drift); Account is the mobile entry to settings/profile. Tapping
 * a mode routes to its home — the page then renders the mobile workspace
 * for that intent. Active tab is derived from the URL via `modeForPath`,
 * so deep links highlight correctly.
 */
import { usePathname } from 'next/navigation'
import { UserCog, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODES, modeForPath, type Mode } from '@/lib/modes'

interface Tab { key: Mode | 'account'; href: string; label: string; icon: LucideIcon }

const TABS: Tab[] = [
  ...MODES.map((m): Tab => ({ key: m.id, href: m.home, label: m.label, icon: m.icon })),
  { key: 'account', href: '/settings', label: 'Account', icon: UserCog },
]

export default function MobileBottomNav() {
  const pathname = usePathname() ?? ''
  const activeMode = modeForPath(pathname)
  const onAccount = pathname.startsWith('/settings')

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1',
      )}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 rounded-2xl border border-border/70 glass-strong p-1 shadow-glow">
        {TABS.map((tab) => {
          const active = tab.key === 'account' ? onAccount : (!onAccount && tab.key === activeMode)
          const Icon = tab.icon
          return (
            <li key={tab.key}>
              <a
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5',
                  'text-[10px] font-medium leading-none touch-manipulation transition-all duration-200',
                  active
                    ? 'bg-gradient-primary text-black shadow-glow'
                    : 'text-muted-foreground active:scale-95 active:bg-accent/40',
                )}
              >
                <Icon
                  className={cn('h-5 w-5 shrink-0 transition-transform', active && 'scale-110')}
                  strokeWidth={active ? 2.25 : 1.75}
                  aria-hidden
                />
                <span className="truncate">{tab.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
