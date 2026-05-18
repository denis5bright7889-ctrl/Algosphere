/**
 * Single source of truth for primary navigation.
 *
 * Consumed by: Sidebar (desktop accordion + mobile drawer),
 * MobileBottomNav, and the ⌘K CommandPalette. Icons are Lucide
 * components — no emojis anywhere in the app chrome.
 *
 * Two cross-cutting concerns live here so every consumer behaves
 * identically:
 *   1. Taxonomy — institutional IA: Intelligence / Markets /
 *      Execution / Portfolio / Community / Tools, plus an
 *      operational Account group (settings/billing/logout — chrome,
 *      not a feature group). One route per real page; we never add a
 *      nav link to a route that doesn't exist.
 *   2. Role-based visibility — `minTier` gates institutional tools
 *      so lower tiers see a simpler nav (the page itself still
 *      enforces its own TierGate; this is purely declutter).
 */
import {
  LayoutDashboard, Activity, Radar, BarChart3, Bell,
  Cpu, ShieldCheck, Landmark, FlaskConical, Ghost, Target,
  CandlestickChart, CalendarDays, Newspaper, Brain, Trophy,
  Users, Network, Crown, MessagesSquare, Repeat,
  BookOpen, Calculator, Briefcase, BrainCircuit, KeyRound, Rocket, GraduationCap,
  Settings2, BadgeDollarSign, Handshake, BadgeCheck, LogOut,
  LineChart, MessageSquare, Wrench, UserCog, Waves,
  Building2, Coins, TrendingUp, Grid3x3, Sparkles,
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
    // "What matters right now?" — the intelligence-first surface.
    label: 'Intelligence',
    icon: BrainCircuit,
    items: [
      { href: '/overview',  label: 'Dashboard',     icon: LayoutDashboard, keywords: 'home command center feed' },
      { href: '/signals',   label: 'Market Feed',   icon: Activity,        keywords: 'signals intelligence feed' },
      { href: '/regime',    label: 'Market Regime', icon: Radar,           keywords: 'volatility trend bias regime' },
      { href: '/intelligence/smart-money',          label: 'Smart Money',          icon: Sparkles,   keywords: 'wallet accumulation conviction onchain' },
      { href: '/intelligence/whale-flows',          label: 'Whale Flows',          icon: Waves,      keywords: 'large transfers accumulation distribution' },
      { href: '/intelligence/exchange-flows',       label: 'Exchange Flows',       icon: Building2,  keywords: 'cex inflow outflow sell pressure' },
      { href: '/intelligence/stablecoin-liquidity', label: 'Stablecoin Liquidity', icon: Coins,      keywords: 'usdt usdc mint burn dry powder' },
      { href: '/intelligence/token-momentum',       label: 'Token Momentum',       icon: TrendingUp, keywords: 'volume holder growth trending' },
      { href: '/intelligence/market-rotation',      label: 'Market Rotation',      icon: Repeat,     keywords: 'sector capital flow narrative' },
      { href: '/intelligence/heatmap',              label: 'On-Chain Heatmap',     icon: Grid3x3,    keywords: 'cross chain intensity liquidity activity' },
      { href: '/whale',     label: 'Whale Analytics', icon: Waves, minTier: 'premium', keywords: 'smart money flows nansen onchain whales' },
      { href: '/alerts',    label: 'Smart Alerts',  icon: Bell,            keywords: 'notifications push channels triggers' },
    ],
  },
  {
    // Real market-data surfaces only. The brief lists Forex/Stocks/
    // Futures/Crypto sub-pages — those routes don't exist, so no
    // dead links are added; these are the genuine markets pages.
    label: 'Markets',
    icon: CandlestickChart,
    items: [
      { href: '/market',   label: 'Market Tracker',    icon: CandlestickChart, keywords: 'prices quotes symbols forex stocks crypto futures' },
      { href: '/calendar', label: 'Economic Calendar', icon: CalendarDays,     keywords: 'events nfp cpi macro' },
      { href: '/news',     label: 'Market News',       icon: Newspaper,        keywords: 'headlines macro' },
    ],
  },
  {
    label: 'Execution',
    icon: Cpu,
    items: [
      { href: '/execution',  label: 'Execution Desk', icon: Cpu,         minTier: 'vip',     keywords: 'auto orders fills bot' },
      { href: '/brokers',    label: 'Brokers',        icon: Landmark,    keywords: 'binance bybit okx mt5 api keys connect' },
      { href: '/risk',       label: 'Risk Engine',    icon: ShieldCheck, keywords: 'drawdown limits position size' },
      { href: '/journal',    label: 'Trade Journal',  icon: BookOpen,    keywords: 'trade log diary' },
      { href: '/shadow',     label: 'Shadow Mode',    icon: Ghost,       minTier: 'premium', keywords: 'paper validation simulation' },
      { href: '/psychology', label: 'AI Psychology Coach', icon: Brain,  keywords: 'mindset tilt emotion discipline' },
    ],
  },
  {
    label: 'Portfolio',
    icon: LineChart,
    items: [
      { href: '/watchlist', label: 'Watchlist',      icon: Bell,      keywords: 'pin instruments universe symbols favourites' },
      { href: '/copy',      label: 'Copy Portfolio', icon: Repeat,    keywords: 'mirror auto follow allocation' },
      { href: '/analytics', label: 'Performance',    icon: BarChart3, keywords: 'pnl stats win rate analytics' },
    ],
  },
  {
    label: 'Community',
    icon: MessageSquare,
    items: [
      { href: '/strategies',  label: 'Strategy Marketplace', icon: Target,        keywords: 'published strategies marketplace subscribe' },
      { href: '/community',   label: 'Community',            icon: Users,         keywords: 'discussion forum threads' },
      { href: '/social',      label: 'Social Feed',          icon: MessagesSquare,keywords: 'posts' },
      { href: '/traders',     label: 'Leaderboards',         icon: Trophy,        keywords: 'ranking top traders verified' },
      { href: '/rooms',       label: 'Trader Rooms',         icon: Network,       keywords: 'voice telegram' },
      { href: '/communities', label: 'Premium Groups',       icon: Crown,         minTier: 'premium', keywords: 'vip exclusive' },
    ],
  },
  {
    label: 'Tools',
    icon: Wrench,
    items: [
      { href: '/backtest',      label: 'Backtester',      icon: FlaskConical, keywords: 'historical simulation' },
      { href: '/quant-builder', label: 'Quant Builder',   icon: BrainCircuit, minTier: 'premium', keywords: 'strategy algo no-code' },
      { href: '/calculators',   label: 'Calculators',     icon: Calculator,   keywords: 'position size lot pip' },
      { href: '/learn',         label: 'Academy',         icon: GraduationCap, keywords: 'education learn course lessons beginner training' },
      { href: '/prop',          label: 'Prop Toolkit',    icon: Briefcase,    minTier: 'premium', keywords: 'ftmo challenge funded' },
      { href: '/api-keys',      label: 'API Access',      icon: KeyRound,     minTier: 'premium', keywords: 'developer token rest' },
      { href: '/launchpad',     label: 'Token Launchpad', icon: Rocket,       minTier: 'vip',     keywords: 'ico presale' },
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
