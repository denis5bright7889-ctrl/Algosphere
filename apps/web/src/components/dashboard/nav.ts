/**
 * Single source of truth for primary navigation.
 *
 * Consumed by: Sidebar (desktop accordion + mobile drawer),
 * MobileBottomNav, and the ⌘K CommandPalette. Icons are Lucide
 * components — no emojis anywhere in the app chrome.
 *
 * ── IA (post-refocus V3, the "Trader Intelligence OS") ──────────────
 *
 * AlgoSphere is no longer a chart-first terminal — it is an AI-powered
 * Trader Intelligence Operating System. The nav reflects the trader's
 * journey: CONNECT → ANALYZE → IMPROVE → VALIDATE → EXECUTE.
 *
 *   Trader Intelligence — Dashboard + AI Coach + Psychology +
 *                         Performance + Risk + Alerts. Who you are
 *                         as a trader. The flagship surface.
 *   Broker Connections — Connected accounts + Trade Journal. Data
 *                        in, intelligence out (not execution-first).
 *   Market Intelligence — Consolidated market view + Markets Explorer
 *                         + AI Signals + Calendar + News + Chart
 *                         Workspace (demoted from primary).
 *   Strategy Lab — Quant Builder + Backtester + Calculators.
 *   Automation — Auto Trading + Shadow + Monitor.
 *   Portfolio — Watchlists.
 *   Premium Community — Telegram Hub (curated only, no social).
 *   Platform — API + Prop + Settings + Billing + Affiliate + Logout.
 *
 * Fragmented engine pages (Conviction / Momentum / Stress / Liquidity /
 * Whale Flows / etc.) are kept as routes but removed from nav — they
 * roll up into the Market Intelligence page. No dead links.
 *
 * Removed in earlier refocus passes (R1–R7): Copy Trading, Academy,
 * Traders Room, Leaderboards, Social Feed, Strategy Marketplace,
 * Communities (replaced with curated Telegram Hub), Launchpad,
 * Verification.
 *
 * Role-based visibility — `minTier` gates institutional tools so lower
 * tiers see a simpler nav (the page itself still enforces its own
 * TierGate; this is purely declutter).
 */
import {
  LayoutDashboard, Activity, BarChart3, Bell,
  Cpu, ShieldAlert, Landmark, FlaskConical, Ghost,
  CandlestickChart, CalendarDays, Newspaper, Brain,
  BookOpen, Calculator, Briefcase, BrainCircuit, KeyRound,
  UserCog, BadgeDollarSign, Handshake, LogOut,
  LineChart, Eye, Globe2, Grid3x3, Sparkles, Crown,
  Server, HeartPulse, FlaskRound, type LucideIcon,
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
    // Who you are as a trader. The flagship surface — every other
    // group exists to feed data into this one.
    label: 'Trader Intelligence',
    icon: Brain,
    items: [
      { href: '/overview',        label: 'Dashboard',        icon: LayoutDashboard, keywords: 'home command center ai trader score summary' },
      { href: '/intelligence/me', label: 'AI Coach',         icon: Brain,           keywords: 'coach strengths weaknesses recommendations mentor evaluation grade advancement quality' },
      { href: '/psychology',      label: 'Psychology',       icon: HeartPulse,      keywords: 'revenge fomo emotional discipline tilt overconfidence mindset behavior' },
      { href: '/analytics',       label: 'Performance',      icon: BarChart3,       keywords: 'win rate profit factor sharpe drawdown expectancy consistency pair session day strategy' },
      { href: '/risk',            label: 'Risk Intelligence', icon: ShieldAlert,    keywords: 'position sizing exposure drawdown risk drift consecutive losses analysis recommendations' },
      { href: '/alerts',          label: 'Smart Alerts',     icon: Bell,            keywords: 'notifications push channels triggers psychology emotional' },
    ],
  },
  {
    // Data in, intelligence out. Broker connections feed the AI engines;
    // execution is downstream of analysis, never the lead.
    label: 'Broker Connections',
    icon: Server,
    items: [
      { href: '/brokers',  label: 'Connected Accounts', icon: Landmark, keywords: 'binance bybit okx mt5 mt4 ctrader api keys connect balance equity sync' },
      { href: '/journal',  label: 'Trade Journal',      icon: BookOpen, keywords: 'trade log diary entries imported notes screenshots ai observations coach' },
    ],
  },
  {
    // Understand the market. Fragmented engines (Conviction/Momentum/
    // Stress/Liquidity/Whale Flows/etc.) roll up into Market Overview;
    // each remains a live route but no longer claims a nav slot.
    label: 'Market Intelligence',
    icon: Globe2,
    items: [
      { href: '/intelligence',          label: 'Market Overview',  icon: Sparkles,         keywords: 'unified dashboard pulse regime liquidity flows sentiment rotation momentum volatility stress consolidated' },
      { href: '/intelligence/markets',  label: 'Markets Explorer', icon: Grid3x3,          keywords: 'symbol registry catalog universe forex crypto indices metals commodities stocks search filter sector' },
      { href: '/signals',               label: 'AI Signals',       icon: Activity,         keywords: 'signals feed alerts trade opportunities ai generated' },
      { href: '/calendar',              label: 'Economic Calendar',icon: CalendarDays,     keywords: 'events nfp cpi macro impact analysis' },
      { href: '/news',                  label: 'Market News',      icon: Newspaper,        keywords: 'headlines macro ai summaries impact scoring' },
      { href: '/workspace',             label: 'Chart Workspace',  icon: CandlestickChart, keywords: 'multi chart tradingview tabs layouts split quad compare overlay favorites recent persistent terminal' },
    ],
  },
  {
    // Build and validate an edge. Charts and execution stay downstream
    // of the lab — you don't deploy what you haven't tested.
    label: 'Strategy Lab',
    icon: FlaskConical,
    items: [
      { href: '/quant-builder', label: 'Quant Builder',        icon: BrainCircuit, minTier: 'premium', keywords: 'visual builder if conditions confirmations entry risk exit indicators smc session multi-timeframe ai no-code' },
      { href: '/backtest',      label: 'Backtester',           icon: FlaskRound,   keywords: 'historical simulation monte carlo slippage spread commission tick candle replay ai explanation edge stability' },
      { href: '/optimization',  label: 'Optimization Center',  icon: Sparkles,     minTier: 'premium', keywords: 'parameter sweep grid search edge stability overfit robustness profit factor sharpe drawdown' },
      { href: '/calculators',   label: 'Calculators',          icon: Calculator,   keywords: 'position size lot pip risk reward' },
    ],
  },
  {
    // Automation is the consequence of intelligence: Analyze → Optimize
    // → Validate → Automate. Live execution is gated; shadow & monitor
    // come first.
    label: 'Automation',
    icon: Cpu,
    items: [
      { href: '/algo',              label: 'Auto Trading',       icon: Cpu,       keywords: 'algo bot mt5 institutional execution gateway desk activate engine semi auto fully' },
      { href: '/shadow',            label: 'Shadow Mode',        icon: Ghost,     minTier: 'premium', keywords: 'paper validation simulation forward test' },
      { href: '/execution/monitor', label: 'Automation Monitor', icon: LineChart, keywords: 'running automations execution logs alerts open positions trades' },
    ],
  },
  {
    // Track outcomes. Watchlists are the only first-class surface here
    // for now; portfolio performance lives under Trader Intelligence >
    // Performance (same /analytics page, different lens).
    label: 'Portfolio',
    icon: Eye,
    items: [
      { href: '/watchlist', label: 'Watchlists', icon: Eye, keywords: 'pin instruments universe symbols favourites' },
    ],
  },
  {
    // A directory, not a forum. Admin-managed Telegram destinations only.
    label: 'Premium Community',
    icon: Crown,
    items: [
      { href: '/communities', label: 'Telegram Hub', icon: Crown,
        keywords: 'telegram channel group vip signals education premium directory' },
    ],
  },
  {
    // Platform & account chrome — operational, not a feature surface.
    label: 'Platform',
    icon: UserCog,
    items: [
      { href: '/api-keys',  label: 'API Access',     icon: KeyRound,        minTier: 'premium', keywords: 'developer token rest webhook' },
      { href: '/prop',      label: 'Prop Toolkit',   icon: Briefcase,       minTier: 'premium', keywords: 'ftmo challenge funded' },
      { href: '/settings',  label: 'Settings',       icon: UserCog,         keywords: 'account security 2fa devices preferences profile notifications' },
      { href: '/upgrade',   label: 'Billing & Plan', icon: BadgeDollarSign, keywords: 'subscription billing plan renew upgrade' },
      { href: '/referrals', label: 'Affiliate',      icon: Handshake,       keywords: 'referral commission' },
      { action: 'logout',   label: 'Logout',         icon: LogOut,          keywords: 'sign out' },
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
