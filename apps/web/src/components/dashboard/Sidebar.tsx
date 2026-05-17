'use client'

import { useEffect, useState, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV_GROUPS, type NavGroup, type NavItem } from './nav'

interface Props {
  onNavigate?: () => void
  /** Icon-only Level-1 rail (desktop collapsed mode). */
  collapsed?: boolean
  /** Called when a category icon in the compact rail is clicked — the
   *  shell can use this to expand the sidebar before opening Level 2. */
  onRequestExpand?: (groupLabel: string) => void
  /** Shell pushes a group to force-open after expansion. `tick` bumps
   *  per call so repeated clicks on the same label re-trigger. */
  pendingExpand?: { group: string; tick: number }
}

const LS_OPEN = 'as_sidebar_open_groups'

/** True if any item in the group matches the current path. */
function groupContainsActive(group: NavGroup, pathname: string): boolean {
  return group.items.some(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  )
}

export default function Sidebar({
  onNavigate, collapsed = false, onRequestExpand, pendingExpand,
}: Props) {
  const pathname = usePathname()

  // Active group — the one containing the current route (if any).
  const activeGroupLabel = useMemo(
    () => NAV_GROUPS.find((g) => groupContainsActive(g, pathname))?.label,
    [pathname],
  )

  // Which Level-1 categories are expanded. Defaults to just the active
  // group (single-open-by-route). Persisted across navigations.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    let initial: string[]
    try {
      const raw = localStorage.getItem(LS_OPEN)
      initial = raw ? (JSON.parse(raw) as string[]) : []
    } catch { initial = [] }
    if (initial.length === 0 && activeGroupLabel) initial = [activeGroupLabel]
    setOpenGroups(new Set(initial))
    setMounted(true)
    // Mount-only; route-change auto-open is handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-open the active group whenever the route changes
  useEffect(() => {
    if (!activeGroupLabel) return
    setOpenGroups((prev) => {
      if (prev.has(activeGroupLabel)) return prev
      const next = new Set(prev)
      next.add(activeGroupLabel)
      return next
    })
  }, [activeGroupLabel])

  // Shell-driven force-open (clicked a category in the compact rail) —
  // re-fires per tick even if the same label is pushed twice.
  const pendingTick = pendingExpand?.tick
  useEffect(() => {
    const label = pendingExpand?.group
    if (!label) return
    setOpenGroups((prev) => {
      if (prev.has(label)) return prev
      const next = new Set(prev)
      next.add(label)
      persist(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTick])

  function persist(set: Set<string>) {
    try { localStorage.setItem(LS_OPEN, JSON.stringify([...set])) } catch {}
  }
  function toggle(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      persist(next)
      return next
    })
  }

  // ───────────────────────── Compact (Level-1 only rail) ─────────────────────────
  if (collapsed) {
    return (
      <nav className="flex flex-col gap-1 px-2 overflow-y-auto" aria-label="Primary">
        {NAV_GROUPS.map((group) => {
          const Icon = group.icon
          const active = group.label === activeGroupLabel
          return (
            <button
              key={group.label}
              type="button"
              title={group.label}
              onClick={() => onRequestExpand?.(group.label)}
              className={cn(
                'group relative flex items-center justify-center rounded-lg py-2.5',
                'transition-all duration-200',
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
                className={cn('h-[18px] w-[18px] transition-transform duration-200', !active && 'group-hover:scale-110')}
                strokeWidth={active ? 2.25 : 1.75}
                aria-hidden
              />
            </button>
          )
        })}
      </nav>
    )
  }

  // ───────────────────────── Expanded (accordion two-level) ──────────────────────
  return (
    <nav className="flex flex-col gap-1 px-2 overflow-y-auto overflow-x-hidden" aria-label="Primary">
      {NAV_GROUPS.map((group) => {
        const Icon = group.icon
        const isOpen = mounted ? openGroups.has(group.label) : group.label === activeGroupLabel
        const hasActive = group.label === activeGroupLabel
        return (
          <div key={group.label} className="flex flex-col">
            {/* Level 1 — category header */}
            <button
              type="button"
              onClick={() => toggle(group.label)}
              // jsx-a11y/aria-proptypes can't statically resolve dynamic
              // expressions on this attribute; the runtime value is always
              // a clean boolean from the ternary above.
              // eslint-disable-next-line jsx-a11y/aria-proptypes
              aria-expanded={isOpen}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold',
                'transition-all duration-200',
                hasActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )}
            >
              <Icon
                className={cn('h-[18px] w-[18px] shrink-0', hasActive && 'text-amber-300 drop-shadow-[0_0_8px_rgba(245,158,11,0.45)]')}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1 text-left tracking-tight">{group.label}</span>
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-300', isOpen && 'rotate-180')}
                strokeWidth={2}
                aria-hidden
              />
            </button>

            {/* Level 2 — animated collapsible item list (grid-rows trick) */}
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-out',
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <ul className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border/60 pl-2">
                  {group.items.map((item) => {
                    const active =
                      pathname === item.href || pathname.startsWith(`${item.href}/`)
                    const ItemIcon = item.icon
                    return (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium',
                            'transition-all duration-200',
                            active
                              ? 'bg-gradient-primary text-white shadow-glow'
                              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                          )}
                        >
                          {active && (
                            <span
                              className="absolute -left-[10px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-amber-300/90"
                              aria-hidden
                            />
                          )}
                          <ItemIcon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} aria-hidden />
                          <span className="truncate">{item.label}</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

// Re-export the type so other consumers needn't double-import
export type { NavGroup, NavItem }
