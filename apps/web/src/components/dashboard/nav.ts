/**
 * Single source of truth for primary navigation.
 *
 * Consumed by: Sidebar (desktop + mobile drawer), MobileBottomNav,
 * and the ⌘K CommandPalette. Icons are Lucide components — no emojis
 * anywhere in the app chrome (institutional design language).
 */
import {
  LayoutDashboard, Activity, Radar, BarChart3, ScrollText,
  Cpu, ShieldCheck, Ghost, PlugZap, FlaskConical, BrainCircuit, Calculator,
  Globe, CalendarDays, Newspaper, Bell,
  MessagesSquare, Users, Network, Crown, Repeat, Trophy,
  GraduationCap, Brain, Briefcase, Award,
  Target, WalletCards, BadgeCheck, Handshake, KeyRound, Gauge, Rocket,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href:  string
  label: string
  icon:  LucideIcon
  /** extra search terms for the command palette */
  keywords?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { href: '/overview',  label: 'Command Center',    icon: LayoutDashboard, keywords: 'home dashboard' },
      { href: '/signals',   label: 'Intelligence Feed',  icon: Activity,        keywords: 'signals alerts trades' },
      { href: '/regime',    label: 'Market Regime',      icon: Radar,           keywords: 'volatility trend' },
      { href: '/analytics', label: 'Performance',        icon: BarChart3,       keywords: 'pnl stats win rate' },
      { href: '/journal',   label: 'Trade Log',          icon: ScrollText,      keywords: 'journal diary' },
    ],
  },
  {
    label: 'Trading',
    items: [
      { href: '/execution',     label: 'Execution Desk',     icon: Cpu,          keywords: 'orders fills' },
      { href: '/risk',          label: 'Risk Engine',        icon: ShieldCheck,  keywords: 'drawdown limits' },
      { href: '/shadow',        label: 'Shadow Mode',        icon: Ghost,        keywords: 'paper validation' },
      { href: '/brokers',       label: 'Broker Connections', icon: PlugZap,      keywords: 'binance bybit okx mt5 api keys' },
      { href: '/backtest',      label: 'Backtester',         icon: FlaskConical, keywords: 'historical simulation' },
      { href: '/quant-builder', label: 'Quant Builder',      icon: BrainCircuit, keywords: 'strategy algo' },
      { href: '/calculators',   label: 'Calculators',        icon: Calculator,   keywords: 'position size lot pip' },
    ],
  },
  {
    label: 'Markets',
    items: [
      { href: '/market',   label: 'Market Tracker',    icon: Globe,        keywords: 'prices quotes' },
      { href: '/calendar', label: 'Economic Calendar', icon: CalendarDays, keywords: 'news events nfp cpi' },
      { href: '/news',     label: 'Market News',       icon: Newspaper,    keywords: 'headlines' },
      { href: '/alerts',   label: 'Alerts',            icon: Bell,         keywords: 'notifications push' },
    ],
  },
  {
    label: 'Social',
    items: [
      { href: '/social',      label: 'Social Feed',    icon: MessagesSquare, keywords: 'posts community' },
      { href: '/community',   label: 'Community',      icon: Users,          keywords: 'discussion' },
      { href: '/rooms',       label: 'Trader Rooms',   icon: Network,        keywords: 'voice telegram' },
      { href: '/communities', label: 'Premium Groups', icon: Crown,          keywords: 'vip exclusive' },
      { href: '/copy',        label: 'Copy Portfolio', icon: Repeat,         keywords: 'mirror auto follow' },
      { href: '/traders',     label: 'Leaderboard',    icon: Trophy,         keywords: 'ranking top traders' },
    ],
  },
  {
    label: 'Learning',
    items: [
      { href: '/learn',        label: 'Education Hub',       icon: GraduationCap, keywords: 'academy courses lessons' },
      { href: '/psychology',   label: 'AI Psychology Coach', icon: Brain,         keywords: 'mindset emotion tilt' },
      { href: '/prop',         label: 'Prop Toolkit',        icon: Briefcase,     keywords: 'ftmo challenge funded' },
      { href: '/achievements', label: 'Achievements',        icon: Award,         keywords: 'badges streak' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/strategies',   label: 'Strategies',      icon: Target,      keywords: 'published marketplace' },
      { href: '/earnings',     label: 'Creator Earnings', icon: WalletCards, keywords: 'revenue profit share payout' },
      { href: '/verification', label: 'Verification',    icon: BadgeCheck,  keywords: 'verified track record' },
      { href: '/referrals',    label: 'Affiliate',       icon: Handshake,   keywords: 'referral commission' },
      { href: '/api-keys',     label: 'API Access',      icon: KeyRound,    keywords: 'developer token rest' },
      { href: '/api-usage',    label: 'API Usage',       icon: Gauge,       keywords: 'rate limit metering' },
      { href: '/launchpad',    label: 'Token Launchpad', icon: Rocket,      keywords: 'ico presale' },
    ],
  },
]

/** Flat list — used by the command palette. */
export const NAV_FLAT: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
