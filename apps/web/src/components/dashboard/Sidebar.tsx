'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_GROUPS } from './nav'

interface Props {
  onNavigate?: () => void
  /** Icon-only compact mode (desktop collapsed rail). */
  collapsed?: boolean
}

export default function Sidebar({ onNavigate, collapsed = false }: Props) {
  const pathname = usePathname()

  return (
    <nav
      className="flex flex-col gap-5 px-2 overflow-y-auto overflow-x-hidden"
      aria-label="Primary"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {collapsed ? (
            <div className="mx-3 my-1 h-px bg-border/60" aria-hidden />
          ) : (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {group.label}
            </p>
          )}

          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center rounded-lg text-sm font-medium',
                  'transition-all duration-200',
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2',
                  active
                    ? 'bg-gradient-primary text-white shadow-glow'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-white/90"
                    aria-hidden
                  />
                )}
                <Icon
                  className={cn(
                    'h-[18px] w-[18px] shrink-0 transition-transform duration-200',
                    !active && 'group-hover:scale-110',
                  )}
                  strokeWidth={active ? 2.25 : 1.75}
                  aria-hidden
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </a>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
