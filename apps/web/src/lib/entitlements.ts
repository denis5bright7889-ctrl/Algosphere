/**
 * AlgoSphere Quant — Feature Entitlement Catalog
 *
 * SINGLE SOURCE OF TRUTH for "which tier unlocks which feature".
 * Every gated surface (UI lock badges, pricing comparison, server checks)
 * should read from here instead of hard-coding tier strings.
 *
 * Tiers ladder: free < starter < premium (Pro) < vip.
 * `minTier` = the lowest paid tier that includes the feature.
 */
import type { SubscriptionTier } from '@/lib/types'

export const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0, starter: 1, premium: 2, vip: 3,
}

/** Does `tier` include everything up to and including `minTier`? */
export function tierIncludes(tier: SubscriptionTier, minTier: SubscriptionTier): boolean {
  return (TIER_RANK[tier] ?? 0) >= (TIER_RANK[minTier] ?? 0)
}

export interface Feature {
  key:     string
  label:   string
  minTier: Extract<SubscriptionTier, 'starter' | 'premium' | 'vip'>
}

export interface FeatureGroup {
  group:    string
  /** Highest tier that owns this group — drives the "X+" pill in the matrix. */
  tier:     'starter' | 'premium' | 'vip'
  features: Feature[]
}

const f = (
  key: string, label: string,
  minTier: Feature['minTier'],
): Feature => ({ key, label, minTier })

/**
 * Catalog mirrors the V3/V4 refocused product. Order = display order.
 *
 * Honesty rules (enforced in this file by inspection — no claim ships
 * that the product doesn't actually fulfil):
 *
 *   • NO copy-trading features. The copy-engine + its tables were
 *     retired in refocus R7; advertising them would be false. Any user
 *     interested in copy-trading should see it isn't offered.
 *   • Trading Journal is the V4 Behavioral Trading Intelligence
 *     System — 5 process grades + ≥3 AI insights per trade + strategy
 *     compatibility. Don't describe it as "notes and tags".
 *   • Execution describes opt-in broker connections + the engine's own
 *     auto-execution layer — never "mirror" or "follow another trader".
 */
export const FEATURE_CATALOG: FeatureGroup[] = [
  // ─── STARTER ───────────────────────────────────────────────────────────
  {
    group: 'AI Signals & Telegram', tier: 'starter',
    features: [
      f('sig.forex',       'Forex signals',                          'starter'),
      f('sig.crypto',      'Crypto signals',                         'starter'),
      f('sig.commodities', 'Metals + commodities signals',           'starter'),
      f('sig.ai_alerts',   'AI signal alerts with regime + risk',    'starter'),
      f('sig.tg_channel',  'Curated Telegram signal channel',        'starter'),
    ],
  },
  {
    group: 'Trader Intelligence Dashboard', tier: 'starter',
    features: [
      f('dash.basic',      'AI Trader Score dashboard',              'starter'),
      f('dash.winloss',    'Win/loss statistics',                    'starter'),
      f('dash.pnl',        'PnL tracking',                           'starter'),
      f('dash.charts',     'Performance charts',                     'starter'),
      f('dash.overview',   'Account overview',                       'starter'),
    ],
  },
  {
    group: 'Behavioral Trade Journal', tier: 'starter',
    features: [
      f('jrnl.manual',     'Manual + broker-imported journaling',    'starter'),
      f('jrnl.notes',      'Trade thesis + post-trade reflection',   'starter'),
      f('jrnl.tags',       'Setup tagging + filtering',              'starter'),
      f('jrnl.review',     'AI process grades (Exec/Psy/Risk/etc.)', 'starter'),
    ],
  },
  {
    group: 'Risk Tools', tier: 'starter',
    features: [
      f('risk.calc',       'Risk calculator',                        'starter'),
      f('risk.possize',    'Position size calculator',               'starter'),
      f('risk.sltp',       'SL/TP helper',                           'starter'),
    ],
  },
  {
    group: 'Broker Connections', tier: 'starter',
    features: [
      f('saas.one_acct',   'Connect ONE broker (MT4/MT5/Binance/…)', 'starter'),
      f('saas.readonly',   'Read-only sync — encrypted credentials', 'starter'),
      f('saas.basic_bot',  'Basic sync analytics',                   'starter'),
    ],
  },

  // ─── PRO ───────────────────────────────────────────────────────────────
  {
    group: 'Performance Intelligence', tier: 'premium',
    features: [
      f('an.verified',     'Performance Intelligence dashboard',     'premium'),
      f('an.equity',       'Equity curve + drawdown analytics',      'premium'),
      f('an.sharpe',       'Sharpe / Sortino / Calmar',              'premium'),
      f('an.drawdown',     'Drawdown clustering analysis',           'premium'),
      f('an.heatmap',      'Pair / session / setup heatmaps',        'premium'),
      f('an.ai_insights',  'AI Coach: pair-specific risk caps',      'premium'),
    ],
  },
  {
    group: 'AI Coach + Psychology Intelligence', tier: 'premium',
    features: [
      f('ai.adv_signals',  'Always-on AI Coach read',                'premium'),
      f('ai.highconf',     'Streak-aware coach (revenge / FOMO)',    'premium'),
      f('ai.trend',        'Discipline + Consistency profiles',      'premium'),
      f('ai.mtf',          'Multi-timeframe confluence on signals',  'premium'),
      f('ai.recos',        'Per-pair risk recommendations',          'premium'),
    ],
  },
  {
    group: 'Strategy Lab (Quant Builder + Backtester)', tier: 'premium',
    features: [
      f('jp.full',         'Visual Quant Builder (18 blocks · SMC)', 'premium'),
      f('jp.psych',        'Backtester with realistic per-asset costs','premium'),
      f('jp.mistake_ai',   'Deployment Readiness ladder (6 stages)', 'premium'),
      f('jp.replay',       'Monte Carlo with sample-size confidence','premium'),
      f('jp.screens',      'Optimization Center — parameter sweeps', 'premium'),
    ],
  },
  {
    group: 'Market Intelligence', tier: 'premium',
    features: [
      f('mi.trends',       'Consolidated Market Overview',           'premium'),
      f('mi.smartmoney',   'Smart-money + whale flow tracking',      'premium'),
      f('mi.whale',        'Whale wallet movement',                  'premium'),
      f('mi.sentiment',    'Sentiment + narrative engine',           'premium'),
      f('mi.momentum',     'Token momentum + breadth + dominance',   'premium'),
    ],
  },
  {
    group: 'Smart Alerts', tier: 'premium',
    features: [
      f('al.telegram',     'Telegram alerts (signal channel + DM)',  'premium'),
      f('al.whatsapp',     'WhatsApp alerts',                        'premium'),
      f('al.email',        'Email alerts',                           'premium'),
      f('al.push',         'Web Push notifications',                 'premium'),
    ],
  },
  {
    group: 'Prop Firm Tools', tier: 'premium',
    features: [
      f('pf.dd',           'Drawdown tracker',                       'premium'),
      f('pf.ftmo',         'FTMO-style compliance monitor',          'premium'),
      f('pf.lot',          'Lot-size assistant',                     'premium'),
      f('pf.dailyloss',    'Daily loss limit monitor',               'premium'),
    ],
  },
  {
    group: 'Broker Connections Pro', tier: 'premium',
    features: [
      f('sb.multi',        'Connect multiple brokers — sync all',    'premium'),
      f('sb.semiauto',     'Semi-automated execution from signals',  'premium'),
      f('sb.mirror',       'Auto-import broker fills to the journal','premium'),
    ],
  },

  // ─── VIP / INSTITUTIONAL ───────────────────────────────────────────────
  {
    group: 'Institutional Execution Engine', tier: 'vip',
    features: [
      f('vx.bot',          'Fully automated AI execution',           'vip'),
      f('vx.routing',      'Smart order routing',                    'vip'),
      f('vx.adaptive',     'Adaptive risk engine',                   'vip'),
      f('vx.regime',       'AI market-regime detection',             'vip'),
      f('vx.liquidity',    'Liquidity-aware execution',              'vip'),
    ],
  },
  {
    group: 'Institutional Risk System (15-gate)', tier: 'vip',
    features: [
      f('vr.exposure',     'Dynamic exposure control',               'vip'),
      f('vr.dd',           'Daily / weekly / max DD protection',     'vip'),
      f('vr.kill',         'Kill-switch protection',                 'vip'),
      f('vr.cooldown',     'Consecutive-loss cooldown',              'vip'),
      f('vr.telemetry',    'Risk telemetry dashboard',               'vip'),
    ],
  },
  {
    group: 'Automation Monitor', tier: 'vip',
    features: [
      f('ve.positions',    'Engine pulse + live positions',          'vip'),
      f('ve.health',       'Bot health & latency monitor',           'vip'),
      f('ve.logs',         'Execution logs + signal feed',           'vip'),
    ],
  },
  // Refocus R7: the Copy Trading feature group was retired alongside the
  // copy_jobs / copy_trades / leaderboard tables. Removed from the
  // catalog because it would otherwise mis-promise a feature that
  // doesn't ship — see [[journal_v4_two_mode_intelligence]] for the
  // engine-execution model that replaces it.
  {
    group: 'On-Chain Intelligence', tier: 'vip',
    features: [
      f('ci.whale',        'Whale & smart-money tracker',            'vip'),
      f('ci.flows',        'Exchange inflow / outflow',              'vip'),
      f('ci.arb',          'Arbitrage & liquidation scanner',        'vip'),
      f('ci.onchain',      'On-chain + funding analytics',           'vip'),
    ],
  },
  {
    group: 'Enterprise', tier: 'vip',
    features: [
      f('ent.whitelabel',  'White-label licensing',                  'vip'),
      f('ent.api',         'Institutional API access',               'vip'),
      f('ent.teams',       'Multi-user teams & sub-accounts',        'vip'),
      f('ent.custom',      'Custom strategy deployment',             'vip'),
    ],
  },
]

/** Flat lookup: feature key → minimum tier. */
export const FEATURE_MIN_TIER: Record<string, Feature['minTier']> =
  Object.fromEntries(
    FEATURE_CATALOG.flatMap(g => g.features.map(ft => [ft.key, ft.minTier])),
  )

/** Server/client gate: can `tier` use `featureKey`? Unknown key → deny. */
export function canUseFeature(tier: SubscriptionTier, featureKey: string): boolean {
  const min = FEATURE_MIN_TIER[featureKey]
  return min ? tierIncludes(tier, min) : false
}

/** Upgrade psychology — the one-line promise per tier. */
export const TIER_PROMISE: Record<'starter' | 'premium' | 'vip', string> = {
  starter: 'Understand your edge — log + grade every trade.',
  premium: 'Build the edge — Strategy Lab + AI Coach + Performance Intel.',
  vip:     'Deploy the edge — institutional execution + 15-gate risk.',
}
