'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  href:  string
  label: string
  icon:  React.ReactNode
}

const ICON_CLASS = 'h-5 w-5 shrink-0'

const ITEMS: NavItem[] = [
  {
    href:  '/overview',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ICON_CLASS} aria-hidden>
        <path d="m3 12 9-9 9 9" /><path d="M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    href:  '/signals',
    label: 'Signals',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ICON_CLASS} aria-hidden>
        <path d="M2 12h3l3-9 4 18 3-9h7" />
      </svg>
    ),
  },
  {
    href:  '/risk',
    label: 'Risk',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ICON_CLASS} aria-hidden>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    href:  '/journal',
    label: 'Journal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ICON_CLASS} aria-hidden>
        <path d="M19 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    ),
  },
  {
    href:  '/social',
    label: 'Social',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ICON_CLASS} aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
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
      {/* Subtle top gradient strip */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary opacity-50" aria-hidden />
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
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
                {item.icon}
                <span className="truncate">{item.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
