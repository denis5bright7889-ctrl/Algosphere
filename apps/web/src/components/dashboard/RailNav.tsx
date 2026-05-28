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
    'relative flex h-11 w-11 items-center justify-center rounded-md transition-colors',
    active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
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

function FlyoutRow({ item }: { item: NavItem }) {
  const Icon = item.icon
  if (item.action === 'logout') {
    return (
      <button type="button" onClick={doLogout}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-rose-300/80 transition-colors hover:bg-rose-500/10 hover:text-rose-300">
        <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{item.label}</span>
      </button>
    )
  }
  return (
    <Link href={item.href!}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
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
    <aside className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-border/70 bg-card/40 py-3">
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
          return (
            <div key={group.label} className="group relative">
              <RailIcon icon={GroupIcon} label={group.label} active={isActive} href={group.items.find((i) => i.href)?.href} />
              {/* Flyout — touches the rail (left-full), descendant of group so hover persists */}
              <div className="absolute left-full top-0 z-50 hidden pl-1.5 group-hover:block group-focus-within:block">
                <div className="min-w-52 rounded-lg border border-border/70 bg-popover p-1.5 shadow-2xl">
                  <p className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => (
                      <li key={item.href ?? item.label}><FlyoutRow item={item} /></li>
                    ))}
                  </ul>
                </div>
              </div>
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
