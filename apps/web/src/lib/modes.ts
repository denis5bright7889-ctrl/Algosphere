/**
 * Global Mode System — the spine of the institutional terminal.
 *
 * The platform has ~40 routes. Showing them all at once was the noise the
 * operator rejected. MT5 / Bloomberg solve this with MODES: one top-level
 * switch that swaps the entire working context so the user only ever sees
 * the surfaces for their current intent.
 *
 *   Trade     — execution clarity (MT5)         → chart + orders + risk
 *   Analyze   — intelligence layering (Bloomberg)→ regime + flows + vol
 *   Research  — strategy development             → backtest + builder
 *   Community — social + marketplace             → leaderboards + rooms
 *
 * One mode = one intent. The sidebar, mobile tab bar, and (later) the
 * main workspace all read from this registry, so the four surfaces never
 * drift. `modeForPath` resolves ANY pathname to a mode so the active mode
 * is always derivable from the URL (deep links land in the right context).
 *
 * This is presentation/IA only — authoritative tier gating still happens
 * server-side per page. `minTier` here is declutter (hide what a tier
 * can't use), mirroring the old nav registry.
 */
import {
  LayoutDashboard, Grid3x3, Cpu, ShieldCheck, BookOpen, Bell, Activity, Landmark,
  Radar, Sparkles, Waves, Network, MessagesSquare, PieChart,
  FlaskConical, BrainCircuit, Calculator, BarChart3,
  Trophy, Target, Users,
  CandlestickChart,
  type LucideIcon,
} from 'lucide-react'
import type { Tier } from '@/components/dashboard/nav'

export type Mode = 'trade' | 'analyze' | 'research' | 'community'

export interface ModeRoute {
  href:     string
  label:    string
  icon:     LucideIcon
  minTier?: Tier
}

export interface ModeDef {
  id:    Mode
  label: string
  icon:  LucideIcon
  /** Where the switcher lands you when you enter this mode. */
  home:  string
  /** One-line intent, shown in the switcher tooltip / mobile header. */
  blurb: string
  items: ModeRoute[]
}

export const MODES: ModeDef[] = [
  {
    id: 'trade', label: 'Trade', icon: CandlestickChart, home: '/overview',
    blurb: 'Execution — chart, orders, positions, risk.',
    items: [
      { href: '/overview',  label: 'Command Center',  icon: LayoutDashboard },
      { href: '/workspace', label: 'Chart Workspace', icon: Grid3x3, minTier: 'premium' },
      { href: '/signals',   label: 'Signals',         icon: Activity },
      { href: '/execution', label: 'Execution Desk',  icon: Cpu, minTier: 'vip' },
      { href: '/risk',      label: 'Risk Engine',     icon: ShieldCheck },
      { href: '/journal',   label: 'Trade Journal',   icon: BookOpen },
      { href: '/watchlist', label: 'Watchlists',      icon: Bell },
      { href: '/brokers',   label: 'Brokers',         icon: Landmark },
    ],
  },
  {
    id: 'analyze', label: 'Analyze', icon: BrainCircuit, home: '/regime',
    blurb: 'Intelligence — regime, flows, liquidity, narrative.',
    items: [
      { href: '/regime',                     label: 'Market Regime', icon: Radar },
      { href: '/intelligence/smart-money',   label: 'Smart Money',   icon: Sparkles, minTier: 'premium' },
      { href: '/intelligence/liquidity',     label: 'Liquidity',     icon: Waves },
      { href: '/intelligence/volatility',    label: 'Volatility',    icon: Activity },
      { href: '/intelligence/correlations',  label: 'Correlations',  icon: Network },
      { href: '/intelligence/narrative',     label: 'Narrative',     icon: MessagesSquare },
      { href: '/intelligence/market-pulse',  label: 'Market Pulse',  icon: PieChart },
    ],
  },
  {
    id: 'research', label: 'Research', icon: FlaskConical, home: '/backtest',
    blurb: 'Strategy lab — backtest, build, explore.',
    items: [
      { href: '/backtest',              label: 'Backtester',          icon: FlaskConical },
      { href: '/quant-builder',         label: 'Quant Builder',       icon: BrainCircuit, minTier: 'premium' },
      { href: '/intelligence/markets',  label: 'Market Explorer',     icon: Grid3x3 },
      { href: '/calculators',           label: 'Calculators',         icon: Calculator },
      { href: '/intelligence/heatmap',  label: 'On-Chain Heatmap',    icon: Grid3x3 },
      { href: '/analytics',             label: 'Historical Analytics',icon: BarChart3 },
    ],
  },
  {
    id: 'community', label: 'Community', icon: Users, home: '/traders',
    blurb: 'Social — leaderboards, marketplace, rooms.',
    items: [
      { href: '/traders',    label: 'Leaderboards',        icon: Trophy },
      { href: '/strategies', label: 'Strategy Marketplace',icon: Target },
      { href: '/social',     label: 'Social Feed',         icon: MessagesSquare },
      { href: '/rooms',      label: 'Trader Rooms',        icon: Network },
    ],
  },
]

export const DEFAULT_MODE: Mode = 'trade'

/** Prefix rules so EVERY route resolves to a mode (not just curated ones). */
const PREFIX_RULES: { prefix: string; mode: Mode }[] = [
  // Analyze — all intelligence surfaces + market data context
  { prefix: '/intelligence', mode: 'analyze' },
  { prefix: '/regime',       mode: 'analyze' },
  { prefix: '/market',       mode: 'analyze' },
  { prefix: '/whale',        mode: 'analyze' },
  { prefix: '/news',         mode: 'analyze' },
  { prefix: '/calendar',     mode: 'analyze' },
  // Research — the strategy lab
  { prefix: '/backtest',     mode: 'research' },
  { prefix: '/quant-builder',mode: 'research' },
  { prefix: '/calculators',  mode: 'research' },
  { prefix: '/analytics',    mode: 'research' },
  { prefix: '/learn',        mode: 'research' },
  { prefix: '/shadow',       mode: 'research' },
  // Community
  { prefix: '/traders',      mode: 'community' },
  { prefix: '/strategies',   mode: 'community' },
  { prefix: '/social',       mode: 'community' },
  { prefix: '/community',    mode: 'community' },
  { prefix: '/communities',  mode: 'community' },
  { prefix: '/rooms',        mode: 'community' },
  { prefix: '/copy',         mode: 'community' },
  // Trade — explicit (the rest fall through to DEFAULT_MODE = trade)
  { prefix: '/overview',     mode: 'trade' },
  { prefix: '/workspace',    mode: 'trade' },
  { prefix: '/signals',      mode: 'trade' },
  { prefix: '/execution',    mode: 'trade' },
  { prefix: '/risk',         mode: 'trade' },
  { prefix: '/journal',      mode: 'trade' },
  { prefix: '/watchlist',    mode: 'trade' },
  { prefix: '/brokers',      mode: 'trade' },
  { prefix: '/algo',         mode: 'trade' },
]

/** Resolve any pathname to its owning mode. Account/system routes
 *  (/settings, /api-keys, /upgrade, …) fall through to the default mode
 *  so the rail always renders a coherent context. */
export function modeForPath(pathname: string): Mode {
  // Longest-prefix wins so e.g. /intelligence/markets (research) beats
  // the broad /intelligence (analyze) rule.
  let best: { mode: Mode; len: number } | null = null
  // Curated mode items first (most specific intent).
  for (const m of MODES) {
    for (const it of m.items) {
      if ((pathname === it.href || pathname.startsWith(it.href + '/')) &&
          (!best || it.href.length > best.len)) {
        best = { mode: m.id, len: it.href.length }
      }
    }
  }
  if (best) return best.mode
  // Then broad prefix rules.
  for (const r of PREFIX_RULES) {
    if ((pathname === r.prefix || pathname.startsWith(r.prefix + '/')) &&
        (!best || r.prefix.length > best.len)) {
      best = { mode: r.mode, len: r.prefix.length }
    }
  }
  return best?.mode ?? DEFAULT_MODE
}

export function getMode(id: Mode): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0]!
}
