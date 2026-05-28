'use client'

/**
 * Mobile bottom nav — fast, complete, no modes.
 *
 * Five tabs: Home · Chart · Trade · Journal · More. The first four are
 * the actions a trader needs instantly (execution is always one tap via
 * Trade); "More" opens the ⌘K command palette — the brain — so every
 * other page/action is reachable in two taps. Nothing is hidden.
 */
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, CandlestickChart, Cpu, BookOpen, Search, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Tab { key: string; label: string; icon: LucideIcon; href?: string; action?: 'search' }

const TABS: Tab[] = [
  { key: 'home',    label: 'Home',    icon: LayoutDashboard,  href: '/overview' },
  { key: 'chart',   label: 'Chart',   icon: CandlestickChart, href: '/workspace' },
  { key: 'trade',   label: 'Trade',   icon: Cpu,              href: '/execution' },
  { key: 'journal', label: 'Journal', icon: BookOpen,         href: '/journal' },
  { key: 'more',    label: 'More',    icon: Search,           action: 'search' },
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
      <ul className="mx-auto grid max-w-md grid-cols-5 rounded-2xl border border-border/70 glass-strong p-1 shadow-glow">
        {TABS.map((tab) => {
          const active = !!tab.href && (pathname === tab.href || pathname.startsWith(`${tab.href}/`))
          const Icon = tab.icon
          const cls = cn(
            'relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5',
            'text-[10px] font-medium leading-none touch-manipulation transition-all duration-200',
            active ? 'bg-gradient-primary text-black shadow-glow' : 'text-muted-foreground active:scale-95 active:bg-accent/40',
          )
          const inner = (
            <>
              <Icon className={cn('h-5 w-5 shrink-0 transition-transform', active && 'scale-110')}
                    strokeWidth={active ? 2.25 : 1.75} aria-hidden />
              <span className="truncate">{tab.label}</span>
            </>
          )
          return (
            <li key={tab.key}>
              {tab.action === 'search' ? (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
                  aria-label="Search everything"
                  className={cn(cls, 'w-full')}
                >
                  {inner}
                </button>
              ) : (
                <a href={tab.href} aria-current={active ? 'page' : undefined} className={cls}>
                  {inner}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
