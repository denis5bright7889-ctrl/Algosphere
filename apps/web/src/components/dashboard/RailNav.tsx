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
 *
 * Visual treatment (2026-05-30 polish): pure-black surface, amber
 * active accent with a contained left bar + ring + soft glow, smooth
 * opacity + translate-x flyout entrance, active-row highlight in the
 * flyout, and pointer-events-none on hidden flyouts so they never
 * block adjacent icon hovers during transitions.
 */
import { useMemo } from 'react'
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
    'group/icon relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200',
    active
      ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40 shadow-[0_0_14px_-3px_rgba(245,158,11,0.55)]'
      : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white',
  )
  const inner = (
    <>
      {active && (
        <span
          className="absolute -left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.65)]"
          aria-hidden
        />
      )}
      <Icon
        className={cn(
          'h-[20px] w-[20px] transition-transform duration-200',
          !active && 'group-hover/icon:scale-110',
        )}
        strokeWidth={active ? 2.1 : 1.75}
        aria-hidden
      />
    </>
  )
  return href
    ? <Link href={href} aria-label={label} title={label} className={cls}>{inner}</Link>
    : <button type="button" aria-label={label} title={label} onClick={onClick} className={cls}>{inner}</button>
}

function FlyoutRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  if (item.action === 'logout') {
    return (
      <button
        type="button"
        onClick={doLogout}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-rose-300/80 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
      >
        <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{item.label}</span>
      </button>
    )
  }
  return (
    <Link
      href={item.href!}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'bg-amber-500/15 text-amber-200'
          : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
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

  return (
    <aside className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-white/[0.08] bg-black py-3">
      {/* Brand → home */}
      <Link
        href="/overview"
        aria-label="AlgoSphere Quant — home"
        className="mb-3 flex h-11 w-11 items-center justify-center transition-transform duration-200 hover:scale-105"
      >
        <Logo size="sm" alt="" priority />
      </Link>

      <RailIcon icon={LayoutDashboard} label="Dashboard" href="/overview" active={active === '/overview'} />

      <div className="my-2 h-px w-7 bg-white/[0.08]" aria-hidden />

      {/* One icon per section; hover opens the flyout */}
      <nav className="flex flex-1 flex-col items-center gap-1.5" aria-label="Sections">
        {NAV_GROUPS.map((group) => {
          const GroupIcon = group.icon
          const isActive = group.label === activeGroup
          return (
            <div key={group.label} className="group relative">
              <RailIcon
                icon={GroupIcon}
                label={group.label}
                active={isActive}
                href={group.items.find((i) => i.href)?.href}
              />
              {/* Flyout — touches the rail (left-full), descendant of group so hover persists.
                  pointer-events-none until visible so it never blocks adjacent icons. */}
              <div className="pointer-events-none absolute left-full top-0 z-50 pl-2 -translate-x-1 opacity-0 transition-all duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100">
                <div className="min-w-56 rounded-xl border border-white/[0.08] bg-zinc-950 p-2 shadow-2xl ring-1 ring-black/40">
                  <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300/70">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const itemActive = !!item.href && item.href === active
                      return (
                        <li key={item.href ?? item.label}>
                          <FlyoutRow item={item} active={itemActive} />
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

      {admin && (
        <>
          <div className="my-1 h-px w-7 bg-white/[0.08]" aria-hidden />
          <RailIcon
            icon={ShieldQuestion}
            label="Admin"
            href="/admin/dashboard"
            active={pathname.startsWith('/admin')}
          />
        </>
      )}
    </aside>
  )
}
