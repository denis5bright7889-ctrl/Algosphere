'use client'

/**
 * RailNav — icon rail + hover flyout (chosen nav format, 2026-05-28).
 *
 * A 64px icon column: Home, then one icon per NAV_GROUPS section, then
 * Admin. Hovering (or focusing) a section opens a flyout listing that
 * section's pages — so the rail stays compact and the workspace gets max
 * canvas, while NOTHING is hidden (every route is one hover away). Same
 * `NAV_GROUPS` registry as the command palette + mobile drawer, so the
 * three never drift.
 *
 * Flyout is CSS-driven (group-hover) — the panel touches the rail (no
 * dead gap) and, being a DOM descendant of the group, keeps the hover
 * alive as the pointer moves onto it. Desktop only; mobile uses the
 * bottom nav.
 */
import { useMemo, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ShieldQuestion, LogOut, type LucideIcon } from 'lucide-react'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { NAV_GROUPS, type NavItem } from './nav'

async function doLogout() {
  try { await createClient().auth.signOut() }
  finally { window.location.href = '/login' }
}

const ALL_HREFS = NAV_GROUPS
  .flatMap((g) => g.items.map((i) => i.href).filter((h): h is string => !!h))
  .sort((a, b) => b.length - a.length)

function activeHref(pathname: string): string | null {
  return ALL_HREFS.find((h) => pathname === h || pathname.startsWith(h + '/')) ?? null
}

function RailIcon({ icon: Icon, active, label, href, onClick }: {
  icon: LucideIcon; active: boolean; label: string; href?: string; onClick?: () => void
}) {
  const cls = cn(
    'relative flex h-11 w-11 items-center justify-center rounded-md transition-colors',
    active ? 'bg-amber-500/15 text-amber-300' : 'text-foreground/70 hover:bg-amber-500/10 hover:text-amber-300',
  )
  const inner = (
    <>
      {active && <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" aria-hidden />}
      <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.1 : 1.75} aria-hidden />
    </>
  )
  return href
    ? <Link href={href} aria-label={label} className={cls}>{inner}</Link>
    : <button type="button" aria-label={label} onClick={onClick} className={cls}>{inner}</button>
}

function FlyoutRow({ item, active = false }: { item: NavItem; active?: boolean }) {
  const Icon = item.icon
  if (item.action === 'logout') {
    return (
      <button type="button" onClick={doLogout}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/15 hover:text-rose-200">
        <LogOut className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
        <span className="truncate">{item.label}</span>
      </button>
    )
  }
  return (
    <Link href={item.href!}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold transition-colors',
        active
          ? 'bg-amber-500/15 text-amber-300'
          : 'text-foreground/90 hover:bg-amber-500/10 hover:text-amber-300',
      )}>
      <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.5 : 2.1} aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

export default function RailNav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname() ?? ''
  const active = useMemo(() => activeHref(pathname), [pathname])
  const activeGroup = useMemo(
    () => NAV_GROUPS.find((g) => g.items.some((i) => i.href === active))?.label ?? null,
    [active],
  )

  // JS-controlled flyout. A short close grace lets the pointer cross the
  // 6px gap from the rail icon to the panel without it snapping shut, but
  // the flyout reliably auto-closes once the cursor leaves both — no more
  // CSS `:hover`/`focus-within` getting stuck open after a click.
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openFlyout(label: string) {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpenGroup(label)
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpenGroup(null), 140)
  }
  function closeNow() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpenGroup(null)
  }

  // Always close on route change + on unmount.
  useEffect(() => { closeNow() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname])
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  return (
    <aside className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-border/70 bg-[#08080a] py-3">
      {/* Brand → home */}
      <Link href="/overview" aria-label="AlgoSphere Quant — home" className="mb-2 flex h-11 w-11 items-center justify-center">
        <Logo size="sm" alt="" priority />
      </Link>

      <RailIcon icon={LayoutDashboard} label="Dashboard" href="/overview" active={active === '/overview'} />

      <div className="my-1 h-px w-7 bg-border/60" aria-hidden />

      {/* One icon per section; hover opens the flyout */}
      <nav className="flex flex-1 flex-col items-center gap-1" aria-label="Sections">
        {NAV_GROUPS.map((group) => {
          const GroupIcon = group.icon
          const isActive = group.label === activeGroup
          const isOpen = openGroup === group.label
          return (
            <div
              key={group.label}
              className="relative"
              onMouseEnter={() => openFlyout(group.label)}
              onMouseLeave={scheduleClose}
              onFocusCapture={() => openFlyout(group.label)}
              onBlurCapture={(e) => {
                // Close when focus leaves the whole group (keyboard users).
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose()
              }}
            >
              <RailIcon icon={GroupIcon} label={group.label} active={isActive} href={group.items.find((i) => i.href)?.href} />
              {/* Flyout — touches the rail (left-full); the pl-1.5 bridge +
                  the close grace let the pointer reach it without flicker. */}
              {isOpen && (
                <div className="absolute left-full top-0 z-50 pl-1.5">
                  <div className="min-w-56 rounded-lg border border-amber-500/20 bg-[#0b0b0e] p-1.5 shadow-2xl shadow-black/60">
                    <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-extrabold uppercase tracking-widest text-amber-300">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => (
                        <li key={item.href ?? item.label}>
                          <FlyoutRow item={item} active={!!item.href && item.href === active} onNavigate={closeNow} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {admin && (
        <>
          <div className="my-1 h-px w-7 bg-border/60" aria-hidden />
          <RailIcon icon={ShieldQuestion} label="Admin" href="/admin/dashboard" active={pathname.startsWith('/admin')} />
        </>
      )}
    </aside>
  )
}
