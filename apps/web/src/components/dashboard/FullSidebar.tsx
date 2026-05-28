'use client'

/**
 * FullSidebar — the complete, always-visible navigation.
 *
 * Driven directly by `NAV_GROUPS` (the single nav registry that also
 * feeds the command palette + mobile drawer), so EVERY route shows — if
 * a page exists, it's here. No curated subset, no modes, no tier
 * filtering: nothing is hidden. The long tail of actions still lives in
 * ⌘K, but every *page* is one click away in this list.
 *
 * Calm, not the old accordion: flat sections with quiet headers, the
 * whole thing scrolls. Active route → gold tint + left accent (longest
 * prefix match). Logout is the one action item (signs out via Supabase).
 */
import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldQuestion } from 'lucide-react'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { NAV_GROUPS, type NavItem } from './nav'

async function doLogout() {
  try { await createClient().auth.signOut() }
  finally { window.location.href = '/login' }
}

// Every href in the registry, longest first — the active item is the most
// specific matching route (e.g. /intelligence/smart-money over /overview).
const ALL_HREFS = NAV_GROUPS
  .flatMap((g) => g.items.map((i) => i.href).filter((h): h is string => !!h))
  .sort((a, b) => b.length - a.length)

function activeHref(pathname: string): string | null {
  return ALL_HREFS.find((h) => pathname === h || pathname.startsWith(h + '/')) ?? null
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon

  if (item.action === 'logout') {
    return (
      <button
        type="button"
        onClick={doLogout}
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-rose-300/80 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{item.label}</span>
      </button>
    )
  }

  return (
    <Link
      href={item.href!}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-primary/12 font-semibold text-primary'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {active && (
        <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
      )}
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.1 : 1.75} aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

export default function FullSidebar({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname() ?? ''
  const active = useMemo(() => activeHref(pathname), [pathname])

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border/70 glass-strong">
      {/* Brand */}
      <div className="flex items-center gap-2 px-3 py-3">
        <Link href="/overview" aria-label="AlgoSphere Quant — home" className="flex min-w-0 items-center gap-2">
          <Logo size="sm" alt="" priority />
          <span className="truncate text-sm font-bold tracking-tight">
            <span className="text-gradient">AlgoSphere</span> <span className="text-foreground/90">Quant</span>
          </span>
        </Link>
      </div>

      {/* Full nav — every group, every item, scrollable */}
      <nav className="scroll-region min-h-0 flex-1 px-2 pb-4" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href ?? item.label}>
                  <NavRow item={item} active={!!item.href && active === item.href} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {admin && (
          <div className="mb-3">
            <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-red-400/60">Admin</p>
            <Link
              href="/admin/dashboard"
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-red-300 transition-colors hover:bg-red-500/10"
            >
              <ShieldQuestion className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate">Admin Dashboard</span>
            </Link>
          </div>
        )}
      </nav>
    </aside>
  )
}
