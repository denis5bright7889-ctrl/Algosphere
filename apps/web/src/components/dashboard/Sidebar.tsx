'use client'

import { useEffect, useState, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { visibleNav, type NavGroup, type NavItem, type Tier } from './nav'
import { usePinnedNav } from './usePinnedNav'

interface Props {
  onNavigate?: () => void
  /** Icon-only Level-1 rail (desktop collapsed mode). */
  collapsed?: boolean
  /** Called when a category icon in the compact rail is clicked. */
  onRequestExpand?: (groupLabel: string) => void
  /** Shell pushes a group to force-open after expansion. */
  pendingExpand?: { group: string; tick: number }
  /** Role-based visibility — defaults to free / non-admin. */
  tier?: Tier
  isAdmin?: boolean
  /**
   * Mobile drawer: exclusive accordion — at most one group expanded
   * at a time so section headers stay legible and tapping a section
   * collapses the others. State is not persisted (drawer is ephemeral).
   */
  exclusive?: boolean
}

const LS_OPEN = 'as_sidebar_open_groups'

function groupContainsActive(group: NavGroup, pathname: string): boolean {
  return group.items.some(
    (i) => i.href && (pathname === i.href || pathname.startsWith(`${i.href}/`)),
  )
}

async function doLogout() {
  try {
    await createClient().auth.signOut()
  } finally {
    window.location.href = '/login'
  }
}

export default function Sidebar({
  onNavigate, collapsed = false, onRequestExpand, pendingExpand,
  tier = 'free', isAdmin = false, exclusive = false,
}: Props) {
  const pathname = usePathname()
  const { pinned, toggle: togglePin, mounted: pinsMounted } = usePinnedNav()

  // Tier-filtered taxonomy — single source of truth for every consumer.
  const groups = useMemo(() => visibleNav(tier, isAdmin), [tier, isAdmin])

  // Resolve pinned hrefs against the *tier-filtered* items so a
  // downgraded user never sees a pin they can no longer access, and
  // stale hrefs silently drop. Preserves the user's pin order.
  const pinnedItems = useMemo(() => {
    const byHref = new Map<string, NavItem>()
    for (const g of groups) for (const it of g.items) {
      if (it.href) byHref.set(it.href, it)
    }
    return pinned
      .map((h) => byHref.get(h))
      .filter((x): x is NavItem => Boolean(x))
  }, [groups, pinned])

  const activeGroupLabel = useMemo(
    () => groups.find((g) => groupContainsActive(g, pathname))?.label,
    [groups, pathname],
  )

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Mobile drawer: exclusive accordion. Open only the active group
    // (if any) so the user lands on a clean list of section headers.
    if (exclusive) {
      setOpenGroups(activeGroupLabel ? new Set([activeGroupLabel]) : new Set())
      setMounted(true)
      return
    }
    let initial: string[]
    try {
      const raw = localStorage.getItem(LS_OPEN)
      initial = raw ? (JSON.parse(raw) as string[]) : []
    } catch { initial = [] }
    if (initial.length === 0 && activeGroupLabel) initial = [activeGroupLabel]
    setOpenGroups(new Set(initial))
    setMounted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeGroupLabel) return
    setOpenGroups((prev) => {
      if (prev.has(activeGroupLabel)) return prev
      const next = new Set(prev)
      next.add(activeGroupLabel)
      return next
    })
  }, [activeGroupLabel])

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
    if (exclusive) return
    try { localStorage.setItem(LS_OPEN, JSON.stringify([...set])) } catch {}
  }
  function toggle(label: string) {
    setOpenGroups((prev) => {
      // Mobile drawer: exclusive — opening a group collapses the others.
      if (exclusive) {
        return prev.has(label) ? new Set() : new Set([label])
      }
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      persist(next)
      return next
    })
  }

  // ── Compact (Level-1 only rail) ──────────────────────────────────────
  if (collapsed) {
    return (
      <nav className="flex flex-col gap-1 px-2 overflow-y-auto" aria-label="Primary">
        {groups.map((group) => {
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
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-white/90" aria-hidden />
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

  // ── Expanded (accordion two-level) ───────────────────────────────────
  return (
    <nav className="flex flex-col gap-1 px-2 overflow-y-auto overflow-x-hidden" aria-label="Primary">
      {/* Pinned — user favourites, always at the very top */}
      {pinsMounted && pinnedItems.length > 0 && (
        <div className="mb-1 flex flex-col">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300/80">
            <Pin className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="flex-1 text-left">Pinned</span>
          </div>
          <ul className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-amber-500/30 pl-2">
            {pinnedItems.map((item) => (
              <li key={`pin-${item.href}`}>
                <NavRow
                  item={item}
                  pathname={pathname}
                  onNavigate={onNavigate}
                  pinned
                  onTogglePin={togglePin}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((group) => {
        const Icon = group.icon
        const isOpen = mounted
          ? openGroups.has(group.label)
          : group.label === activeGroupLabel
        const hasActive = group.label === activeGroupLabel
        return (
          <div key={group.label} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              // jsx-a11y/aria-proptypes can't statically resolve the dynamic
              // expression; runtime value is always a clean boolean.
              // eslint-disable-next-line jsx-a11y/aria-proptypes
              aria-expanded={isOpen}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-bold uppercase tracking-[0.12em]',
                'transition-all duration-200',
                hasActive
                  ? 'text-amber-300'
                  : 'text-white hover:bg-accent/40',
              )}
            >
              <Icon
                className={cn('h-[18px] w-[18px] shrink-0', hasActive && 'text-amber-300 drop-shadow-[0_0_8px_rgba(245,158,11,0.45)]')}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex-1 text-left">{group.label}</span>
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-300', isOpen && 'rotate-180')}
                strokeWidth={2}
                aria-hidden
              />
            </button>

            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-out',
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <ul className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border/60 pl-2">
                  {group.items.map((item) => (
                    <li key={item.href ?? item.label}>
                      <NavRow
                        item={item}
                        pathname={pathname}
                        onNavigate={onNavigate}
                        pinned={!!item.href && pinned.includes(item.href)}
                        onTogglePin={togglePin}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

function NavRow({
  item, pathname, onNavigate, pinned = false, onTogglePin,
}: {
  item: NavItem
  pathname: string
  onNavigate?: () => void
  pinned?: boolean
  onTogglePin?: (href: string) => void
}) {
  const ItemIcon = item.icon
  const base =
    'group/row relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all duration-200 min-h-[40px]'

  // Action item (logout) — button, no pin affordance.
  if (item.action === 'logout') {
    return (
      <button
        type="button"
        onClick={() => { onNavigate?.(); doLogout() }}
        className={cn(base, 'w-full text-left text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-300')}
      >
        <ItemIcon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{item.label}</span>
      </button>
    )
  }

  const active =
    pathname === item.href || pathname.startsWith(`${item.href}/`)

  // Pin toggle lives as a sibling of the link (interactive elements
  // must not nest). Container owns hover state via group/row.
  return (
    <div className="group/row relative flex items-center">
      <a
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 pr-8 text-[14px] font-medium transition-all duration-200 min-h-[40px]',
          active
            ? 'bg-gradient-primary text-white shadow-glow'
            : 'text-white/95 hover:bg-accent/40 hover:text-white',
        )}
      >
        {active && (
          <span className="absolute -left-[10px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-amber-300/90" aria-hidden />
        )}
        <ItemIcon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{item.label}</span>
      </a>
      {item.href && onTogglePin && (
        <button
          type="button"
          onClick={() => onTogglePin(item.href!)}
          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          // jsx-a11y/aria-proptypes can't resolve the dynamic expression;
          // `pinned` is always a clean boolean.
          // eslint-disable-next-line jsx-a11y/aria-proptypes
          aria-pressed={pinned}
          title={pinned ? 'Unpin' : 'Pin to top'}
          className={cn(
            'absolute right-1 flex h-7 w-7 items-center justify-center rounded-md transition-all touch-manipulation',
            pinned
              ? 'text-amber-300'
              : 'text-muted-foreground/40 opacity-60 hover:text-foreground hover:opacity-100 group-hover/row:opacity-100',
          )}
        >
          <Pin
            className="h-3.5 w-3.5"
            strokeWidth={2}
            fill={pinned ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
      )}
    </div>
  )
}

export type { NavGroup, NavItem }
