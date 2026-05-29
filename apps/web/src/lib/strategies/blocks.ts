/**
 * Modular strategy block catalog (Refocus R5b).
 *
 * Each block is a typed condition or action a user can compose into a
 * strategy. The catalog is the source of truth: the editor reads it to
 * render the palette, the validator reads it to enforce param ranges,
 * and the backtester (R5c) will read it to actually evaluate logic on
 * historical bars.
 *
 * No I/O. Pure data + typed helpers.
 *
 * Versioning rules
 * ----------------
 *   - Adding a block is non-breaking — existing saved configs ignore it.
 *   - Removing a block requires the validator to surface a clear error
 *     ("block X is no longer supported"); never silently rewrite saved
 *     versions.
 *   - Renaming a `key` is BREAKING — bump versions and add a migration.
 *
 * Param schema
 * ------------
 * Every param declares `kind`, `default`, and optional `min`/`max`/
 * `options`. The editor renders the appropriate input control and the
 * validator clamps / rejects out-of-range values.
 */

export type BlockCategory =
  | 'indicators' | 'price_action' | 'smart_money'
  | 'session' | 'volatility' | 'risk' | 'ai'

export type BlockParamKind = 'int' | 'float' | 'enum' | 'bool'

export interface BlockParam {
  key:     string
  label:   string
  kind:    BlockParamKind
  default: number | string | boolean
  min?:    number
  max?:    number
  step?:   number
  options?: readonly string[]
  hint?:   string
}

export interface BlockDefinition {
  key:       string
  label:     string
  category:  BlockCategory
  summary:   string
  params:    readonly BlockParam[]
  /** Editor grouping when this block fires (entry condition vs exit). */
  scope:     'entry' | 'exit' | 'filter' | 'risk'
}

/** Single source of truth — editor + validator + backtester read this. */
export const BLOCK_CATALOG: readonly BlockDefinition[] = [

  // ─── Indicators ──────────────────────────────────────────────
  {
    key: 'ema_alignment', label: 'EMA Alignment', category: 'indicators', scope: 'filter',
    summary: 'Fast EMA above/below slow EMA in the chosen direction.',
    params: [
      { key: 'fast', label: 'Fast EMA period', kind: 'int', default: 9,   min: 2,  max: 200 },
      { key: 'slow', label: 'Slow EMA period', kind: 'int', default: 21,  min: 5,  max: 400 },
      { key: 'direction', label: 'Direction', kind: 'enum', default: 'either', options: ['bull','bear','either'] },
    ],
  },
  {
    key: 'rsi_band', label: 'RSI in band', category: 'indicators', scope: 'filter',
    summary: 'RSI within a chosen band — keep entries within a quality window.',
    params: [
      { key: 'period', label: 'Period', kind: 'int',   default: 14, min: 2, max: 100 },
      { key: 'lower',  label: 'Lower',  kind: 'float', default: 40, min: 0, max: 100 },
      { key: 'upper',  label: 'Upper',  kind: 'float', default: 70, min: 0, max: 100 },
    ],
  },
  {
    key: 'macd_cross', label: 'MACD cross', category: 'indicators', scope: 'entry',
    summary: 'MACD line crosses the signal line in the chosen direction.',
    params: [
      { key: 'fast',   label: 'Fast EMA',   kind: 'int', default: 12, min: 2, max: 60 },
      { key: 'slow',   label: 'Slow EMA',   kind: 'int', default: 26, min: 5, max: 120 },
      { key: 'signal', label: 'Signal EMA', kind: 'int', default: 9,  min: 2, max: 60 },
      { key: 'direction', label: 'Direction', kind: 'enum', default: 'up', options: ['up','down','either'] },
    ],
  },
  {
    key: 'bollinger_position', label: 'Bollinger position', category: 'indicators', scope: 'filter',
    summary: 'Price is at upper / lower / inside the Bollinger bands.',
    params: [
      { key: 'period', label: 'Period', kind: 'int',   default: 20, min: 5, max: 100 },
      { key: 'std',    label: 'Std-dev', kind: 'float', default: 2,  min: 1, max: 4, step: 0.5 },
      { key: 'where',  label: 'Position', kind: 'enum', default: 'upper', options: ['upper','lower','inside','outside'] },
    ],
  },

  // ─── Price action ────────────────────────────────────────────
  {
    key: 'engulfing_candle', label: 'Engulfing candle', category: 'price_action', scope: 'entry',
    summary: 'Bullish or bearish engulfing pattern at the close.',
    params: [
      { key: 'direction', label: 'Direction', kind: 'enum', default: 'bull', options: ['bull','bear'] },
    ],
  },
  {
    key: 'swing_break', label: 'Swing break', category: 'price_action', scope: 'entry',
    summary: 'Close breaks the prior swing high or low.',
    params: [
      { key: 'lookback', label: 'Lookback bars', kind: 'int', default: 10, min: 3, max: 60 },
      { key: 'direction', label: 'Direction', kind: 'enum', default: 'either', options: ['high','low','either'] },
    ],
  },

  // ─── Smart money ─────────────────────────────────────────────
  {
    key: 'order_block_tap', label: 'Order block tap', category: 'smart_money', scope: 'entry',
    summary: 'Price returns to a recent institutional order block.',
    params: [
      { key: 'lookback', label: 'Lookback bars', kind: 'int', default: 24, min: 5, max: 200 },
      { key: 'min_displacement_atr', label: 'Min displacement (ATR)', kind: 'float', default: 1.5, min: 0.5, max: 5 },
    ],
  },
  {
    key: 'fair_value_gap', label: 'Fair value gap', category: 'smart_money', scope: 'entry',
    summary: 'Three-candle FVG — gap left by impulsive displacement.',
    params: [
      { key: 'direction', label: 'Direction', kind: 'enum', default: 'either', options: ['bull','bear','either'] },
      { key: 'min_gap_atr', label: 'Min gap (ATR)', kind: 'float', default: 0.3, min: 0.1, max: 2 },
    ],
  },
  {
    key: 'liquidity_sweep', label: 'Liquidity sweep', category: 'smart_money', scope: 'entry',
    summary: 'Price wicks beyond the prior day high/low and reverses inside.',
    params: [
      { key: 'level', label: 'Level', kind: 'enum', default: 'pdh_pdl', options: ['pdh_pdl','weekly','session'] },
      { key: 'min_excursion_atr', label: 'Min excursion (ATR)', kind: 'float', default: 0.6, min: 0.2, max: 3 },
    ],
  },

  // ─── Session filters ─────────────────────────────────────────
  {
    key: 'session_window', label: 'Session window', category: 'session', scope: 'filter',
    summary: 'Only allow entries during the chosen trading session(s).',
    params: [
      { key: 'sessions', label: 'Sessions', kind: 'enum', default: 'london_ny',
        options: ['london','new_york','london_ny','asian','any'] },
    ],
  },
  {
    key: 'block_news', label: 'Block around news', category: 'session', scope: 'filter',
    summary: 'Skip entries within N minutes of a high-impact macro event.',
    params: [
      { key: 'minutes_before', label: 'Minutes before', kind: 'int', default: 15, min: 0, max: 240 },
      { key: 'minutes_after',  label: 'Minutes after',  kind: 'int', default: 15, min: 0, max: 240 },
      { key: 'impact', label: 'Min impact', kind: 'enum', default: 'high', options: ['low','medium','high'] },
    ],
  },

  // ─── Volatility filters ──────────────────────────────────────
  {
    key: 'atr_band', label: 'ATR in band', category: 'volatility', scope: 'filter',
    summary: 'Trade only when ATR percentile sits inside a chosen band.',
    params: [
      { key: 'period',     label: 'ATR period',         kind: 'int',   default: 14, min: 5, max: 100 },
      { key: 'lower_pct',  label: 'Lower percentile',   kind: 'float', default: 30, min: 0, max: 100 },
      { key: 'upper_pct',  label: 'Upper percentile',   kind: 'float', default: 80, min: 0, max: 100 },
    ],
  },

  // ─── Risk conditions ─────────────────────────────────────────
  {
    key: 'fixed_risk_per_trade', label: 'Fixed % risk', category: 'risk', scope: 'risk',
    summary: 'Position-size for a fixed % of equity at risk per trade.',
    params: [
      { key: 'risk_pct', label: 'Risk per trade %', kind: 'float', default: 1.0, min: 0.1, max: 5, step: 0.1 },
      { key: 'sl_atr',   label: 'SL = N × ATR',     kind: 'float', default: 1.2, min: 0.2, max: 5, step: 0.1 },
      { key: 'rr',       label: 'R:R target',        kind: 'float', default: 2.0, min: 1,   max: 5, step: 0.5 },
    ],
  },
  {
    key: 'max_open_positions', label: 'Max open positions', category: 'risk', scope: 'risk',
    summary: 'Cap simultaneous open positions.',
    params: [
      { key: 'cap', label: 'Cap', kind: 'int', default: 3, min: 1, max: 20 },
    ],
  },
  {
    key: 'daily_loss_cap', label: 'Daily loss cap', category: 'risk', scope: 'risk',
    summary: 'Stop trading for the day after losing N% of equity.',
    params: [
      { key: 'cap_pct', label: 'Daily DD cap %', kind: 'float', default: 3, min: 0.5, max: 10, step: 0.5 },
    ],
  },

  // ─── AI conditions ───────────────────────────────────────────
  {
    key: 'engine_confidence', label: 'Engine confidence', category: 'ai', scope: 'filter',
    summary: 'Require AlgoSphereQuant confidence above threshold (45/70/85 bands).',
    params: [
      { key: 'min', label: 'Min confidence', kind: 'int', default: 70, min: 0, max: 100 },
    ],
  },
  {
    key: 'engine_regime_allow', label: 'Engine regime allow-list', category: 'ai', scope: 'filter',
    summary: 'Only fire in selected regimes; skip in suppressed ones.',
    params: [
      { key: 'regimes', label: 'Regimes', kind: 'enum', default: 'trending_only',
        options: ['trending_only','trending_or_breakout','ranging_only','any_non_suppressed'] },
    ],
  },
] as const


// ─── Editor / validator helpers ─────────────────────────────────────

export type BlockKey = (typeof BLOCK_CATALOG)[number]['key']

export const BLOCK_BY_KEY = Object.fromEntries(
  BLOCK_CATALOG.map((b) => [b.key, b]),
) as Record<BlockKey, BlockDefinition>

export const BLOCKS_BY_CATEGORY: Record<BlockCategory, BlockDefinition[]> =
  BLOCK_CATALOG.reduce((acc, b) => {
    if (!acc[b.category]) acc[b.category] = []
    acc[b.category]!.push(b)
    return acc
  }, {} as Record<BlockCategory, BlockDefinition[]>)


/**
 * Strategy config — a serialized version that lives in
 * user_strategy_versions.config.
 */
export interface StrategyConfig {
  schema_version: 1
  meta: {
    pair?:      string
    timeframe?: string
    notes?:     string
  }
  /** Instances of blocks the user dragged into the strategy. */
  blocks: BlockInstance[]
}

export interface BlockInstance {
  /** Stable per-instance UUID — survives reordering. */
  id:    string
  key:   BlockKey
  /** Param values, keyed by BlockParam.key. */
  params: Record<string, number | string | boolean>
}


/**
 * Validate + clamp a config in one pass. Returns the cleaned config
 * plus a list of human-readable issues. Throws nothing; the editor
 * surfaces issues inline.
 */
export function validateStrategyConfig(
  cfg: StrategyConfig,
): { cleaned: StrategyConfig; issues: string[] } {
  const issues: string[] = []
  const cleaned: StrategyConfig = {
    schema_version: 1,
    meta: { ...cfg.meta },
    blocks: [],
  }

  for (const b of cfg.blocks ?? []) {
    const def = BLOCK_BY_KEY[b.key as BlockKey]
    if (!def) {
      issues.push(`Block "${b.key}" is no longer in the catalog — skipped.`)
      continue
    }
    const params: BlockInstance['params'] = {}
    for (const p of def.params) {
      const raw = b.params?.[p.key]
      params[p.key] = clamp(p, raw, issues, def.label)
    }
    cleaned.blocks.push({ id: b.id, key: b.key, params })
  }

  return { cleaned, issues }
}


function clamp(
  p:      BlockParam,
  raw:    number | string | boolean | undefined,
  issues: string[],
  blockLabel: string,
): number | string | boolean {
  if (raw == null) return p.default
  if (p.kind === 'int' || p.kind === 'float') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) {
      issues.push(`${blockLabel} · ${p.label}: not a number, reset to ${p.default}.`)
      return p.default
    }
    let v = n
    if (p.min != null && v < p.min) { issues.push(`${blockLabel} · ${p.label} below min (${p.min}); clamped.`); v = p.min }
    if (p.max != null && v > p.max) { issues.push(`${blockLabel} · ${p.label} above max (${p.max}); clamped.`); v = p.max }
    return p.kind === 'int' ? Math.round(v) : v
  }
  if (p.kind === 'enum') {
    if (p.options && !p.options.includes(String(raw))) {
      issues.push(`${blockLabel} · ${p.label}: unknown option "${raw}", reset to ${p.default}.`)
      return p.default
    }
    return String(raw)
  }
  if (p.kind === 'bool') return Boolean(raw)
  return p.default
}


/** Convenience: a fresh blank config with one fixed-risk block. */
export function blankConfig(): StrategyConfig {
  return {
    schema_version: 1,
    meta: {},
    blocks: [{
      id: crypto.randomUUID(),
      key: 'fixed_risk_per_trade',
      params: { risk_pct: 1.0, sl_atr: 1.2, rr: 2.0 },
    }],
  }
}
