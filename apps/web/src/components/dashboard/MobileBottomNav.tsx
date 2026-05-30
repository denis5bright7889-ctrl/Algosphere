'use client'

/**
 * Mobile bottom nav — fast, complete, no modes.
 *
 * Four tabs: Home · Coach · Markets · Journal. The platform is an
 * AI Trader Intelligence OS, so the thumb tabs lead with the trader
 * (Home + Coach), the market (Markets), and the data feed (Journal).
 * Anything else is reachable via the sidebar drawer; the ⌘K command
 * palette stays available on desktop but no longer claims a thumb tab.
 */
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Brain, Globe2, BookOpen, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Tab { key: string; label: string; icon: LucideIcon; href: string }

const TABS: Tab[] = [
  { key: 'home',    label: 'Home',    icon: LayoutDashboard, href: '/overview' },
  { key: 'coach',   label: 'Coach',   icon: Brain,           href: '/intelligence/me' },
  { key: 'markets', label: 'Markets', icon: Globe2,          href: '/intelligence' },
  { key: 'journal', label: 'Journal', icon: BookOpen,        href: '/journal' },
]

export default function MobileBottomNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1',
      )}
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 rounded-2xl border border-border/70 glass-strong p-1 shadow-glow">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          const Icon = tab.icon
          const cls = cn(
            'relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5',
            'text-[10px] font-medium leading-none touch-manipulation transition-all duration-200',
            active ? 'bg-gradient-primary text-black shadow-glow' : 'text-muted-foreground active:scale-95 active:bg-accent/40',
          )
          return (
            <li key={tab.key}>
              <a href={tab.href} aria-current={active ? 'page' : undefined} className={cls}>
                <Icon className={cn('h-5 w-5 shrink-0 transition-transform', active && 'scale-110')}
                      strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                <span className="truncate">{tab.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
