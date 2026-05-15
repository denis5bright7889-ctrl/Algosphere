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
 * Catalog mirrors the published tier spec verbatim. Order = display order.
 */
export const FEATURE_CATALOG: FeatureGroup[] = [
  // ─── STARTER ───────────────────────────────────────────────────────────
  {
    group: 'Signals Access', tier: 'starter',
    features: [
      f('sig.forex',       'Forex signals',              'starter'),
      f('sig.crypto',      'Crypto signals',             'starter'),
      f('sig.commodities', 'Commodities signals',        'starter'),
      f('sig.ai_alerts',   'Basic AI trade alerts',      'starter'),
      f('sig.tg_channel',  'Telegram signal channel',    'starter'),
    ],
  },
  {
    group: 'Dashboard', tier: 'starter',
    features: [
      f('dash.basic',      'Basic trading dashboard',    'starter'),
      f('dash.winloss',    'Win/loss statistics',        'starter'),
      f('dash.pnl',        'PnL tracking',               'starter'),
      f('dash.charts',     'Basic performance charts',   'starter'),
      f('dash.overview',   'Account overview',           'starter'),
    ],
  },
  {
    group: 'Trading Journal Lite', tier: 'starter',
    features: [
      f('jrnl.manual',     'Manual trade journaling',    'starter'),
      f('jrnl.notes',      'Notes & psychology notes',   'starter'),
      f('jrnl.tags',       'Trade tagging',              'starter'),
      f('jrnl.review',     'Basic review system',        'starter'),
    ],
  },
  {
    group: 'Risk Tools', tier: 'starter',
    features: [
      f('risk.calc',       'Basic risk calculator',      'starter'),
      f('risk.possize',    'Position size calculator',   'starter'),
      f('risk.sltp',       'SL/TP helper',               'starter'),
    ],
  },
  {
    group: 'SaaS Access', tier: 'starter',
    features: [
      f('saas.one_acct',   'Connect ONE exchange / MT5', 'starter'),
      f('saas.readonly',   'Read-only bot dashboard',    'starter'),
      f('saas.basic_bot',  'Limited bot analytics',      'starter'),
    ],
  },

  // ─── PRO ───────────────────────────────────────────────────────────────
  {
    group: 'Advanced Analytics', tier: 'premium',
    features: [
      f('an.verified',     'Verified performance dashboard', 'premium'),
      f('an.equity',       'Equity curve analytics',         'premium'),
      f('an.sharpe',       'Sharpe ratio',                   'premium'),
      f('an.drawdown',     'Drawdown analytics',             'premium'),
      f('an.heatmap',      'Portfolio heatmaps',             'premium'),
      f('an.ai_insights',  'AI performance insights',        'premium'),
    ],
  },
  {
    group: 'AI & Automation', tier: 'premium',
    features: [
      f('ai.adv_signals',  'Advanced AI signals',            'premium'),
      f('ai.highconf',     'High-confidence filtering',      'premium'),
      f('ai.trend',        'AI trend analysis',              'premium'),
      f('ai.mtf',          'Multi-timeframe confluence',     'premium'),
      f('ai.recos',        'Smart trade recommendations',    'premium'),
    ],
  },
  {
    group: 'Trading Journal PRO', tier: 'premium',
    features: [
      f('jp.full',         'Full performance analytics',     'premium'),
      f('jp.psych',        'Psychology tracking',            'premium'),
      f('jp.mistake_ai',   'Mistake detection AI',           'premium'),
      f('jp.replay',       'Session replay & grading',       'premium'),
      f('jp.screens',      'Screenshot attachments',         'premium'),
    ],
  },
  {
    group: 'Market Intelligence', tier: 'premium',
    features: [
      f('mi.trends',       'Profitable-trader trends',       'premium'),
      f('mi.smartmoney',   'Smart-money tracking',           'premium'),
      f('mi.whale',        'Whale wallet movement',          'premium'),
      f('mi.sentiment',    'Sentiment analysis',             'premium'),
      f('mi.momentum',     'Token momentum scanner',         'premium'),
    ],
  },
  {
    group: 'Alerts System', tier: 'premium',
    features: [
      f('al.telegram',     'Telegram alerts',                'premium'),
      f('al.whatsapp',     'WhatsApp alerts',                'premium'),
      f('al.email',        'Email alerts',                   'premium'),
      f('al.push',         'Browser push notifications',     'premium'),
    ],
  },
  {
    group: 'Prop Firm Tools', tier: 'premium',
    features: [
      f('pf.dd',           'Drawdown tracker',               'premium'),
      f('pf.ftmo',         'FTMO-style compliance monitor',  'premium'),
      f('pf.lot',          'Lot-size assistant',             'premium'),
      f('pf.dailyloss',    'Daily loss limit monitor',       'premium'),
    ],
  },
  {
    group: 'SaaS Bot Enhancements', tier: 'premium',
    features: [
      f('sb.multi',        'Connect multiple exchanges',     'premium'),
      f('sb.semiauto',     'Semi-automated execution',       'premium'),
      f('sb.mirror',       'Signal mirroring & sync',        'premium'),
    ],
  },

  // ─── VIP / INSTITUTIONAL ───────────────────────────────────────────────
  {
    group: 'Institutional Execution Engine', tier: 'vip',
    features: [
      f('vx.bot',          'Fully automated AI execution',   'vip'),
      f('vx.routing',      'Smart order routing',            'vip'),
      f('vx.adaptive',     'Adaptive risk engine',           'vip'),
      f('vx.regime',       'AI market-regime detection',     'vip'),
      f('vx.liquidity',    'Liquidity-aware execution',      'vip'),
    ],
  },
  {
    group: 'Institutional Risk System', tier: 'vip',
    features: [
      f('vr.exposure',     'Dynamic exposure control',       'vip'),
      f('vr.dd',           'Daily/weekly/max DD protection', 'vip'),
      f('vr.kill',         'Kill-switch protection',         'vip'),
      f('vr.cooldown',     'Consecutive-loss cooldown',      'vip'),
      f('vr.telemetry',    'Risk telemetry dashboard',       'vip'),
    ],
  },
  {
    group: 'Live Execution Dashboard', tier: 'vip',
    features: [
      f('ve.positions',    'Live positions & floating PnL',  'vip'),
      f('ve.health',       'Bot health & latency monitor',   'vip'),
      f('ve.logs',         'Execution logs & replay',        'vip'),
    ],
  },
  {
    group: 'Copy Trading', tier: 'vip',
    features: [
      f('ct.follow',       'Follow & copy top traders',      'vip'),
      f('ct.publish',      'Publish strategies, earn fees',  'vip'),
      f('ct.leaderboard',  'Leaderboards & risk scoring',    'vip'),
    ],
  },
  {
    group: 'Crypto Intelligence', tier: 'vip',
    features: [
      f('ci.whale',        'Whale & smart-money tracker',    'vip'),
      f('ci.flows',        'Exchange inflow/outflow',        'vip'),
      f('ci.arb',          'Arbitrage & liquidation scanner','vip'),
      f('ci.onchain',      'On-chain & funding analytics',   'vip'),
    ],
  },
  {
    group: 'Enterprise', tier: 'vip',
    features: [
      f('ent.whitelabel',  'White-label licensing',          'vip'),
      f('ent.api',         'Institutional API access',       'vip'),
      f('ent.teams',       'Multi-user teams & sub-accounts','vip'),
      f('ent.custom',      'Custom strategy deployment',     'vip'),
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
  starter: 'Learn and receive signals.',
  premium: 'Become consistently profitable.',
  vip:     'Trade like a hedge fund.',
}
