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
  Server, HeartPulse, FlaskRound, Waves, MessagesSquare,
  Repeat, Rocket, type LucideIcon,
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
  /** Admin-only. Operational/diagnostic surfaces (engine pulse,
   *  automation monitor) live here; regular users never see them.
   *  See [[feedback_admin_vs_user_surfaces]]. */
  adminOnly?: boolean
  /** Extra search terms for the command palette. */
  keywords?: string
}

export interface NavGroup {
  label: string
  icon:  LucideIcon
  items: NavItem[]
  /** Admin-only group — every item hidden from regular users.
   *  Used for entire operations groups + the Community/Telegram
   *  directory (which is a marketing surface, not a trader workflow). */
  adminOnly?: boolean
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
    // V3 Intelligence hub — Capital Flows. Parent overview + 4 deep
    // pages. Sidebar IA collapse per the V3 spec
    // ([[market_intel_v3_spec]]): users see the overview first; the
    // deep specialist surfaces remain accessible as detail views.
    label: 'Capital Flows',
    icon: Waves,
    items: [
      { href: '/intelligence/capital-flows',       label: 'Overview',             icon: Waves,    keywords: 'capital flows overview hub consolidated smart money whale exchange stablecoin' },
      { href: '/intelligence/smart-money',         label: 'Smart Money',          icon: BrainCircuit, keywords: 'institutional capital flow conviction wallet rotation accumulation distribution bias' },
      { href: '/intelligence/whale-flows',         label: 'Whale Flows',          icon: Activity, keywords: 'whale movement accumulation distribution institutional capital netflow' },
      { href: '/intelligence/stablecoin-liquidity',label: 'Stablecoin Liquidity', icon: Landmark, keywords: 'stablecoin liquidity dry powder market cap usdt usdc dai' },
      { href: '/intelligence/exchange-flows',      label: 'Exchange Flows',       icon: BarChart3, keywords: 'exchange inflow outflow netflow sell pressure accumulation' },
    ],
  },
  {
    // V3 Intelligence hub — Market Sentiment. Crowd behaviour: what is
    // being talked about, where attention is concentrating, who is
    // participating ([[market_intel_v3_spec]]).
    label: 'Market Sentiment',
    icon: MessagesSquare,
    items: [
      { href: '/intelligence/sentiment',    label: 'Overview',      icon: MessagesSquare, keywords: 'sentiment overview hub crowd narrative attention participation' },
      { href: '/intelligence/narrative',    label: 'Narrative',     icon: Brain,          keywords: 'theme narrative landscape ai defi memes l1 acceleration fatigue crowding' },
      { href: '/intelligence/attention',    label: 'Attention',     icon: Sparkles,       keywords: 'social attention mentions surge cooling narrative dominance' },
      { href: '/intelligence/participation', label: 'Participation', icon: HeartPulse,    keywords: 'participation quality whale smart money aggression imbalance by asset' },
    ],
  },
  {
    // V3 Intelligence hub — Market Structure. Where capital is rotating,
    // breadth and dominance ([[market_intel_v3_spec]]).
    label: 'Market Structure',
    icon: Repeat,
    items: [
      { href: '/intelligence/structure',      label: 'Overview',             icon: Repeat,    keywords: 'structure overview hub dominance breadth rotation sectors' },
      { href: '/intelligence/dominance',      label: 'Dominance & Rotation', icon: Globe2,    keywords: 'btc dominance market cap risk-on risk-off rotation eth alt' },
      { href: '/intelligence/sectors',        label: 'Sector Intelligence',  icon: Grid3x3,   keywords: 'sectors performance defi infrastructure l1 memes ai gaming rwa' },
      { href: '/intelligence/breadth',        label: 'Market Breadth',       icon: BarChart3, keywords: 'breadth advancers decliners participation broad narrow' },
      { href: '/intelligence/market-rotation',label: 'Market Rotation',      icon: Activity,  keywords: 'rotation sectors momentum capital flow leadership' },
    ],
  },
  {
    // V3 Intelligence hub — Momentum. Per-symbol conviction + phase +
    // positioning. The existing /intelligence/momentum is the deep
    // "Phase" view; the hub overview lives at /intelligence/momentum-hub
    // ([[market_intel_v3_spec]]).
    label: 'Momentum',
    icon: Rocket,
    items: [
      { href: '/intelligence/momentum-hub', label: 'Overview',       icon: Rocket,        keywords: 'momentum overview hub conviction phase positioning' },
      { href: '/intelligence/conviction',   label: 'Conviction',     icon: BrainCircuit,  keywords: 'conviction multi-layer agreement momentum regime volatility smart money macro' },
      { href: '/intelligence/momentum',     label: 'Momentum Phase', icon: Activity,      keywords: 'momentum phase trending expansion exhaustion accumulation parabolic quality sustainability' },
      { href: '/intelligence/positioning',  label: 'Positioning',    icon: LineChart,     keywords: 'positioning leverage funding open interest crowding liquidation risk' },
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
      { href: '/execution/monitor', label: 'Automation Monitor', icon: LineChart, adminOnly: true, keywords: 'running automations execution logs alerts open positions trades engine pulse risk telemetry' },
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
    // A directory, not a forum — and crucially, a curated marketing
    // surface, not a trader workflow. Surfaced to every signed-in user
    // (2026-06-02 founder reversal of the earlier admin-only rule)
    // so users can discover the official AlgoSphere Telegram channels
    // and join them in one tap.
    label: 'Premium Community',
    icon: Crown,
    items: [
      { href: '/communities', label: 'Telegram Hub', icon: Crown,
        keywords: 'telegram channel group vip signals education premium directory' },
    ],
  },
  {
    // Admin-only operations group — diagnostic surfaces that must NEVER
    // appear in a regular user sidebar per the founder rule
    // ([[feedback_admin_vs_user_surfaces]]). The Automation Monitor
    // lives under Automation as an adminOnly item (so it stays in its
    // semantic group for admins); the Intelligence Health page is
    // structurally an ops surface so it groups here.
    label: 'Operations',
    icon: ShieldAlert,
    adminOnly: true,
    items: [
      { href: '/admin/intelligence-health', label: 'Intelligence Health', icon: Activity,
        adminOnly: true,
        keywords: 'admin ops observability provider health credits fallback cache telemetry intelligence engines' },
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
 *
 * Filtering rules:
 *   • adminOnly groups → dropped entirely for non-admins
 *   • adminOnly items  → dropped for non-admins
 *   • items above the user's tier → dropped
 *   • empty groups → dropped
 *
 * Admins see everything regardless of tier or adminOnly flags.
 */
export function visibleNav(
  tier: Tier = 'free',
  isAdmin = false,
): NavGroup[] {
  const rank = TIER_RANK[tier] ?? 0
  return NAV_GROUPS
    // Drop whole admin-only groups (Community / future Operations) for users.
    .filter((g) => isAdmin || !g.adminOnly)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        if (isAdmin) return true
        if (i.adminOnly) return false
        if (i.minTier && rank < TIER_RANK[i.minTier]) return false
        return true
      }),
    }))
    .filter((g) => g.items.length > 0)
}

/** A nav item guaranteed to have an href (no action items). */
export type NavLink = NavItem & { href: string }

/** Flat list of navigable items — used by the command palette.
 *  Excludes adminOnly items + items inside adminOnly groups so the
 *  ⌘K palette doesn't expose ops/community surfaces to regular users.
 *  Admins reach those via direct URL or via /admin/ops. */
export const NAV_FLAT: NavLink[] = NAV_GROUPS
  .filter((g) => !g.adminOnly)
  .flatMap((g) => g.items)
  .filter((i): i is NavLink => typeof i.href === 'string' && !i.adminOnly)
