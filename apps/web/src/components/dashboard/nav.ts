/**
 * Single source of truth for primary navigation.
 *
 * Consumed by: Sidebar (desktop accordion + mobile drawer),
 * MobileBottomNav, and the ⌘K CommandPalette. Icons are Lucide
 * components — no emojis anywhere in the app chrome.
 *
 * Two cross-cutting concerns live here so every consumer behaves
 * identically:
 *   1. Taxonomy — institutional IA, intelligence-first:
 *      Intelligence / Markets / Execution / Portfolio / Research /
 *      Community / System. One route per real page; we never add a
 *      nav link to a route that doesn't exist (no dead links, ever).
 *   2. Role-based visibility — `minTier` gates institutional tools
 *      so lower tiers see a simpler nav (the page itself still
 *      enforces its own TierGate; this is purely declutter).
 */
import {
  LayoutDashboard, Activity, Radar, BarChart3, Bell,
  Cpu, ShieldCheck, ShieldAlert, Landmark, FlaskConical, Ghost, Target,
  CandlestickChart, CalendarDays, Newspaper, Brain, Trophy,
  Users, Network, Crown, MessagesSquare, Repeat,
  BookOpen, Calculator, Briefcase, BrainCircuit, KeyRound, Rocket, GraduationCap,
  Settings2, BadgeDollarSign, Handshake, BadgeCheck, LogOut,
  LineChart, MessageSquare, UserCog, Waves, PieChart,
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
      // ── Intelligence Core (universe-level institutional engines) ────
      { href: '/intelligence/conviction',           label: 'Conviction',           icon: Target,     keywords: 'multi layer agreement bias bullish bearish high moderate confidence' },
      { href: '/intelligence/momentum',             label: 'Momentum Phase',       icon: Rocket,     keywords: 'phase accumulation trending parabolic exhaustion distribution sustainability quality cross asset' },
      { href: '/intelligence/stress',               label: 'Market Stress',        icon: ShieldAlert, keywords: 'environment volatility macro defensive aggressive risk posture systemic' },
      { href: '/intelligence/participation',        label: 'Participation',        icon: PieChart,   keywords: 'who driving price smart money whales aggression retail imbalance' },
      { href: '/regime',    label: 'Market Regime', icon: Radar,           keywords: 'volatility trend bias regime' },
      // ── On-chain Intelligence (per-token / per-flow surfaces) ───────
      { href: '/intelligence/smart-money',          label: 'Smart Money',          icon: Sparkles,   keywords: 'wallet accumulation conviction onchain nansen' },
      { href: '/intelligence/whale-flows',          label: 'Whale Flows',          icon: Waves,      keywords: 'large transfers accumulation distribution' },
      { href: '/intelligence/exchange-flows',       label: 'Exchange Flows',       icon: Building2,  keywords: 'cex inflow outflow sell pressure' },
      { href: '/intelligence/stablecoin-liquidity', label: 'Stablecoin Liquidity', icon: Coins,      keywords: 'usdt usdc mint burn dry powder' },
      { href: '/intelligence/token-momentum',       label: 'Token Momentum',       icon: TrendingUp, keywords: 'volume holder growth trending crypto per token nansen on chain' },
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
      { href: '/algo',       label: 'Auto Trading',   icon: Cpu,         keywords: 'algo bot mt5 institutional execution gateway desk activate engine' },
      { href: '/execution',  label: 'Execution Desk', icon: Cpu,         minTier: 'vip',     keywords: 'auto orders fills bot live dashboard' },
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
      { href: '/watchlist', label: 'Watchlists',     icon: Bell,      keywords: 'pin instruments universe symbols favourites' },
      { href: '/analytics', label: 'Performance',    icon: BarChart3, keywords: 'pnl stats win rate analytics equity curve' },
      { href: '/copy',      label: 'Copy Trading',   icon: Repeat,    keywords: 'mirror auto follow allocation portfolio' },
    ],
  },
  {
    // Research & strategy lab — building/validating an edge, not
    // executing it. Split out of the old "Tools" grab-bag.
    label: 'Research',
    icon: FlaskConical,
    items: [
      { href: '/quant-builder', label: 'Quant Builder', icon: BrainCircuit,  minTier: 'premium', keywords: 'strategy algo no-code lab builder' },
      { href: '/backtest',      label: 'Backtester',    icon: FlaskConical,  keywords: 'historical simulation strategy lab' },
      { href: '/calculators',   label: 'Calculators',   icon: Calculator,    keywords: 'position size lot pip risk' },
      { href: '/learn',         label: 'Academy',       icon: GraduationCap, keywords: 'education learn course lessons training data lab' },
    ],
  },
  {
    label: 'Community',
    icon: MessageSquare,
    items: [
      { href: '/community',   label: 'Community Feed',       icon: Users,         keywords: 'discussion forum threads' },
      { href: '/strategies',  label: 'Strategy Marketplace', icon: Target,        keywords: 'published strategies marketplace subscribe' },
      { href: '/social',      label: 'Social Feed',          icon: MessagesSquare,keywords: 'posts ideas' },
      { href: '/traders',     label: 'Leaderboards',         icon: Trophy,        keywords: 'ranking top traders verified' },
      { href: '/rooms',       label: 'Trader Rooms',         icon: Network,       keywords: 'voice telegram' },
      { href: '/communities', label: 'Premium Groups',       icon: Crown,         minTier: 'premium', keywords: 'vip exclusive' },
    ],
  },
  {
    // Platform & account chrome — notifications, developer access,
    // billing, identity. Operational, not a feature surface.
    label: 'System',
    icon: Settings2,
    items: [
      { href: '/api-keys',     label: 'API Access',   icon: KeyRound,        minTier: 'premium', keywords: 'developer token rest webhook' },
      { href: '/prop',         label: 'Prop Toolkit', icon: Briefcase,       minTier: 'premium', keywords: 'ftmo challenge funded' },
      { href: '/launchpad',    label: 'Token Launchpad', icon: Rocket,       minTier: 'vip',     keywords: 'ico presale' },
      { href: '/settings',     label: 'Settings',     icon: UserCog,         keywords: 'account security 2fa devices preferences' },
      { href: '/upgrade',      label: 'Billing & Plan', icon: BadgeDollarSign, keywords: 'subscription billing plan renew upgrade' },
      { href: '/referrals',    label: 'Affiliate',    icon: Handshake,       keywords: 'referral commission' },
      { href: '/verification', label: 'Verification', icon: BadgeCheck,      keywords: 'verified track record kyc' },
      { action: 'logout',      label: 'Logout',       icon: LogOut,          keywords: 'sign out' },
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
