'use client'

/**
 * IconRail — the workstation left rail (MT5 / TradingView class).
 *
 * Replaces the old 40-item accordion sidebar. The brief's #1 complaint
 * was noise: seven groups, forty links, all shouting at once. A trading
 * terminal does not work that way — it shows a tight column of icons for
 * the surfaces you actually live in, and pushes the long tail behind
 * search (⌘K). That's exactly this.
 *
 *   • 12 curated destinations — the ones a trader opens every session.
 *   • Hover → label tooltip (so nothing is mystery-meat).
 *   • Active route → gold accent bar + lifted background.
 *   • Tier-aware: items above the viewer's tier are dropped (the page
 *     still enforces its own gate; this is declutter only).
 *   • Footer: ⌘K search (the other ~28 routes), Settings, Admin.
 *
 * Everything not on the rail remains reachable via the command palette
 * and the mobile drawer — no route is orphaned.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Activity, CandlestickChart, Grid3x3, Radar,
  BrainCircuit, Bell, Landmark, ShieldCheck, BookOpen, BarChart3,
  FlaskConical, Search, UserCog, Settings2,
  type LucideIcon,
} from 'lucide-react'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import type { Tier } from './nav'

const TIER_RANK: Record<Tier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }

interface RailItem {
  href:    string
  label:   string
  icon:    LucideIcon
  minTier?: Tier
  /** Match these path prefixes for the active state (beyond exact href). */
  match?:  string[]
}

// The 12 surfaces a trader actually lives in. Order = frequency of use.
const RAIL: RailItem[] = [
  { href: '/overview',  label: 'Command Center', icon: LayoutDashboard },
  { href: '/signals',   label: 'Signals',        icon: Activity },
  { href: '/market',    label: 'Markets',        icon: CandlestickChart },
  { href: '/workspace', label: 'Chart Workspace',icon: Grid3x3, minTier: 'premium' },
  { href: '/regime',    label: 'Market Regime',  icon: Radar },
  { href: '/intelligence/conviction', label: 'Intelligence', icon: BrainCircuit, match: ['/intelligence'] },
  { href: '/watchlist', label: 'Watchlists',     icon: Bell },
  { href: '/brokers',   label: 'Brokers',        icon: Landmark },
  { href: '/risk',      label: 'Risk Engine',    icon: ShieldCheck },
  { href: '/journal',   label: 'Trade Journal',  icon: BookOpen },
  { href: '/analytics', label: 'Performance',    icon: BarChart3 },
  { href: '/backtest',  label: 'Backtester',     icon: FlaskConical },
]

function isActive(pathname: string, item: RailItem): boolean {
  if (pathname === item.href) return true
  if (pathname.startsWith(item.href + '/')) return true
  return (item.match ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function RailLink({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {/* Active accent bar — the TV/MT5 selected-tool affordance */}
      {active && (
        <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
      )}
      <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.1 : 1.75} aria-hidden />

      {/* Hover label — floats to the right, never reflows the rail */}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-[calc(100%+0.5rem)] z-50 whitespace-nowrap rounded-md',
          'border border-border/70 bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground shadow-xl',
          'opacity-0 -translate-x-1 transition-all duration-150',
          'group-hover:opacity-100 group-hover:translate-x-0',
        )}
      >
        {item.label}
      </span>
    </Link>
  )
}

export default function IconRail({
  admin = false,
  tier = 'free',
}: {
  admin?: boolean
  tier?: Tier
}) {
  const pathname = usePathname() ?? ''
  const rank = TIER_RANK[tier] ?? 0
  const items = RAIL.filter((i) => admin || !i.minTier || rank >= TIER_RANK[i.minTier])

  return (
    <aside className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-border/70 glass-strong py-3">
      {/* Brand mark — links home */}
      <Link href="/overview" aria-label="AlgoSphere Quant — home" className="mb-3 flex h-11 w-11 items-center justify-center">
        <Logo size="sm" alt="" priority />
      </Link>

      {/* Primary destinations */}
      <nav className="flex flex-1 flex-col items-center gap-1.5">
        {items.map((item) => (
          <RailLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>

      {/* Footer — search (long tail), settings, admin */}
      <div className="mt-2 flex flex-col items-center gap-1.5 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          aria-label="Search everything (⌘K)"
          className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-accent/50 hover:text-foreground"
        >
          <Search className="h-[20px] w-[20px]" strokeWidth={1.75} aria-hidden />
          <span
            role="tooltip"
            className="pointer-events-none absolute left-[calc(100%+0.5rem)] z-50 whitespace-nowrap rounded-md border border-border/70 bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground shadow-xl opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
          >
            Search · ⌘K
          </span>
        </button>

        <RailLink
          item={{ href: '/settings', label: 'Settings', icon: UserCog }}
          active={isActive(pathname, { href: '/settings', label: 'Settings', icon: UserCog })}
        />

        {admin && (
          <Link
            href="/admin/dashboard"
            aria-label="Admin Dashboard"
            className={cn(
              'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all',
              pathname.startsWith('/admin')
                ? 'bg-red-500/15 text-red-300'
                : 'text-red-400/70 hover:bg-red-500/10 hover:text-red-300',
            )}
          >
            <Settings2 className="h-[20px] w-[20px]" strokeWidth={1.75} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-[calc(100%+0.5rem)] z-50 whitespace-nowrap rounded-md border border-red-500/40 bg-popover px-2.5 py-1.5 text-xs font-medium text-red-200 shadow-xl opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0"
            >
              Admin Dashboard
            </span>
          </Link>
        )}
      </div>
    </aside>
  )
}
