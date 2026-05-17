/**
 * Single source of truth for primary navigation.
 *
 * Consumed by: Sidebar (desktop accordion + mobile drawer),
 * MobileBottomNav, and the ⌘K CommandPalette. Icons are Lucide
 * components — no emojis anywhere in the app chrome.
 *
 * Two cross-cutting concerns live here so every consumer behaves
 * identically:
 *   1. Taxonomy — six fixed groups (Core/Trading/Analytics/Social/
 *      Tools/Account).
 *   2. Role-based visibility — `minTier` gates institutional tools
 *      so lower tiers see a simpler nav (the page itself still
 *      enforces its own TierGate; this is purely declutter).
 */
import {
  LayoutDashboard, Activity, Radar, BarChart3, Bell,
  Cpu, ShieldCheck, Landmark, FlaskConical, Ghost, Target,
  CandlestickChart, CalendarDays, Newspaper, Brain, Trophy,
  Users, Network, Crown, MessagesSquare, Repeat,
  BookOpen, Calculator, Briefcase, BrainCircuit, KeyRound, Rocket,
  Settings2, BadgeDollarSign, Handshake, BadgeCheck, LogOut,
  Compass, LineChart, MessageSquare, Wrench, UserCog,
  type LucideIcon,
} from 'lucide-react'

export type Tier = 'free' | 'starter' | 'premium' | 'vip'
const TIER_RANK: Record<Tier, number> = { free: 0, starter: 1, premium: 2, vip: 3 }

export interface NavItem {
  label: string
  icon:  LucideIcon
  /** Route. Omitted for action items (e.g. logout). */
  href?: string
  /** Non-navigation action. Sidebar renders these as buttons. */
  action?: 'logout'
  /** Minimum subscription tier to see this item. Absent = everyone. */
  minTier?: Tier
  /** Extra search terms for the command palette. */
  keywords?: string
}

export interface NavGroup {
  label: string
  icon:  LucideIcon
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core',
    icon: Compass,
    items: [
      { href: '/overview',  label: 'Dashboard',         icon: LayoutDashboard, keywords: 'home command center' },
      { href: '/signals',   label: 'Intelligence Feed', icon: Activity,        keywords: 'signals feed alerts' },
      { href: '/regime',    label: 'Market Regime',     icon: Radar,           keywords: 'volatility trend bias' },
      { href: '/analytics', label: 'Performance',       icon: BarChart3,       keywords: 'pnl stats win rate analytics' },
      { href: '/alerts',    label: 'Alerts',            icon: Bell,            keywords: 'notifications push channels' },
    ],
  },
  {
    label: 'Trading',
    icon: CandlestickChart,
    items: [
      { href: '/execution', label: 'Execution Desk',     icon: Cpu,          minTier: 'vip',     keywords: 'auto orders fills bot' },
      { href: '/risk',      label: 'Risk Engine',        icon: ShieldCheck,  keywords: 'drawdown limits position size' },
      { href: '/brokers',   label: 'Broker Connections', icon: Landmark,     keywords: 'binance bybit okx mt5 api keys' },
      { href: '/backtest',  label: 'Backtester',         icon: FlaskConical, keywords: 'historical simulation' },
      { href: '/shadow',    label: 'Shadow Mode',        icon: Ghost,        minTier: 'premium', keywords: 'paper validation' },
      { href: '/strategies', label: 'Strategies',        icon: Target,       keywords: 'published marketplace' },
    ],
  },
  {
    label: 'Analytics',
    icon: LineChart,
    items: [
      { href: '/market',     label: 'Market Tracker',      icon: CandlestickChart, keywords: 'prices quotes symbols' },
      { href: '/calendar',   label: 'Economic Calendar',   icon: CalendarDays,     keywords: 'events nfp cpi news' },
      { href: '/news',       label: 'Market News',         icon: Newspaper,        keywords: 'headlines' },
      { href: '/psychology', label: 'AI Psychology Coach', icon: Brain,            keywords: 'mindset tilt emotion' },
      { href: '/traders',    label: 'Leaderboards',        icon: Trophy,           keywords: 'ranking top traders' },
    ],
  },
  {
    label: 'Social',
    icon: MessageSquare,
    items: [
      { href: '/community',   label: 'Community',      icon: Users,          keywords: 'discussion forum' },
      { href: '/rooms',       label: 'Trader Rooms',   icon: Network,        keywords: 'voice telegram' },
      { href: '/communities', label: 'Premium Groups', icon: Crown,          minTier: 'premium', keywords: 'vip exclusive' },
      { href: '/social',      label: 'Social Feed',    icon: MessagesSquare, keywords: 'posts' },
      { href: '/copy',        label: 'Copy Portfolio', icon: Repeat,         keywords: 'mirror auto follow' },
    ],
  },
  {
    label: 'Tools',
    icon: Wrench,
    items: [
      { href: '/journal',       label: 'Journal',        icon: BookOpen,    keywords: 'trade log diary' },
      { href: '/calculators',   label: 'Calculators',    icon: Calculator,  keywords: 'position size lot pip' },
      { href: '/prop',          label: 'Prop Toolkit',   icon: Briefcase,   minTier: 'premium', keywords: 'ftmo challenge funded' },
      { href: '/quant-builder', label: 'Quant Builder',  icon: BrainCircuit, minTier: 'premium', keywords: 'strategy algo no-code' },
      { href: '/api-keys',      label: 'API Access',     icon: KeyRound,    minTier: 'premium', keywords: 'developer token rest' },
      { href: '/launchpad',     label: 'Token Launchpad', icon: Rocket,     minTier: 'vip',     keywords: 'ico presale' },
    ],
  },
  {
    label: 'Account',
    icon: UserCog,
    items: [
      { href: '/settings',     label: 'Settings',     icon: Settings2,        keywords: 'account security 2fa devices' },
      { href: '/upgrade',      label: 'Subscription', icon: BadgeDollarSign,  keywords: 'billing plan renew upgrade' },
      { href: '/referrals',    label: 'Affiliate',    icon: Handshake,        keywords: 'referral commission' },
      { href: '/verification', label: 'Verification', icon: BadgeCheck,       keywords: 'verified track record' },
      { action: 'logout',      label: 'Logout',       icon: LogOut,           keywords: 'sign out' },
    ],
  },
]

/**
 * Returns the nav groups visible to a given tier (admins see all).
 * Items above the user's tier are dropped; empty groups are dropped.
 */
export function visibleNav(
  tier: Tier = 'free',
  isAdmin = false,
): NavGroup[] {
  const rank = TIER_RANK[tier] ?? 0
  return NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => isAdmin || !i.minTier || rank >= TIER_RANK[i.minTier],
      ),
    }))
    .filter((g) => g.items.length > 0)
}

/** A nav item guaranteed to have an href (no action items). */
export type NavLink = NavItem & { href: string }

/** Flat list of navigable items — used by the command palette. */
export const NAV_FLAT: NavLink[] = NAV_GROUPS
  .flatMap((g) => g.items)
  .filter((i): i is NavLink => typeof i.href === 'string')
