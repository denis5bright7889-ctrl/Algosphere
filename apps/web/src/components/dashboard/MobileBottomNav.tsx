'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, Globe, Activity, Users, UserCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Item { href: string; label: string; icon: LucideIcon }

const ITEMS: Item[] = [
  { href: '/overview',  label: 'Home',      icon: LayoutDashboard },
  { href: '/market',    label: 'Markets',   icon: Globe },
  { href: '/signals',   label: 'Signals',   icon: Activity },
  { href: '/community', label: 'Community', icon: Users },
  { href: '/settings',  label: 'Profile',   icon: UserCircle },
]

export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1',
      )}
    >
      {/* Floating rounded glass bar */}
      <ul className="mx-auto grid max-w-md grid-cols-5 rounded-2xl border border-border/70 glass-strong p-1 shadow-glow">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5',
                  'text-[10px] font-medium leading-none touch-manipulation transition-all duration-200',
                  active
                    ? 'bg-gradient-primary text-white shadow-glow'
                    : 'text-muted-foreground active:scale-95 active:bg-accent/40',
                )}
              >
                <Icon
                  className={cn('h-5 w-5 shrink-0 transition-transform', active && 'scale-110')}
                  strokeWidth={active ? 2.25 : 1.75}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
