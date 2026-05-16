'use client'

import { usePathname } from 'next/navigation'
import { LayoutDashboard, Activity, ShieldCheck, ScrollText, MessagesSquare, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Item { href: string; label: string; icon: LucideIcon }

const ITEMS: Item[] = [
  { href: '/overview', label: 'Home',    icon: LayoutDashboard },
  { href: '/signals',  label: 'Signals', icon: Activity },
  { href: '/risk',     label: 'Risk',    icon: ShieldCheck },
  { href: '/journal',  label: 'Journal', icon: ScrollText },
  { href: '/social',   label: 'Social',  icon: MessagesSquare },
]

export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden glass-strong',
        'pb-[max(env(safe-area-inset-bottom),0.25rem)]',
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary opacity-50" aria-hidden />
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5',
                  'text-[10px] font-medium leading-none touch-manipulation transition-colors',
                  active
                    ? 'text-amber-300 glow-text-gold'
                    : 'text-muted-foreground active:bg-accent/50',
                )}
              >
                {active && (
                  <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-gradient-primary" aria-hidden />
                )}
                <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                <span className="truncate">{item.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
