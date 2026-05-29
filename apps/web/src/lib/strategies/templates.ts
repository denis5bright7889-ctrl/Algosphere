/**
 * Strategy template library (Refocus R5b).
 *
 * Predefined compositions a user can clone and customise. Each
 * template is a typed `StrategyTemplate` with metadata + a starting
 * `StrategyConfig`. The /api/strategies POST endpoint reads this when
 * a `template_key` is passed.
 *
 * Templates are static data — no I/O. Adding one is a single PR edit;
 * the catalog is the single source of truth.
 */
import type { StrategyConfig, BlockKey } from './blocks'


export interface StrategyTemplate {
  key:         string
  name:        string
  category:    'scalp' | 'swing' | 'breakout' | 'mean_reversion'
             | 'trend' | 'smart_money' | 'liquidity' | 'session'
  summary:     string
  pair_hint:   string          // shown in the editor as a suggestion
  timeframe:   string
  config:      StrategyConfig
}


/** Build a config from a flat list of block specs. Generates the per-
 *  instance ids so authors don't need to. */
function build(specs: Array<{ key: BlockKey; params?: Record<string, number | string | boolean> }>): StrategyConfig {
  return {
    schema_version: 1,
    meta: {},
    blocks: specs.map((s) => ({
      id: cryptoRandom(),
      key: s.key,
      params: s.params ?? {},
    })),
  }
}

/** crypto.randomUUID() isn't safe at module-init in older node; use a
 *  cheap collision-resistant fallback for templates (UI overrides
 *  these ids when cloning anyway). */
function cryptoRandom(): string {
  return 'tpl-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}


export const STRATEGY_TEMPLATES: readonly StrategyTemplate[] = [

  {
    key: 'scalping_session',
    name: 'Session Scalping',
    category: 'scalp',
    summary: 'Tight ATR band + London/NY session + RSI quality window. High-frequency, low-R:R.',
    pair_hint: 'EURUSD',
    timeframe: '5m',
    config: build([
      { key: 'session_window', params: { sessions: 'london_ny' } },
      { key: 'atr_band',       params: { lower_pct: 40, upper_pct: 80 } },
      { key: 'rsi_band',       params: { lower: 35, upper: 65 } },
      { key: 'engulfing_candle', params: { direction: 'bull' } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 0.5, sl_atr: 0.8, rr: 1.5 } },
      { key: 'max_open_positions',   params: { cap: 2 } },
      { key: 'daily_loss_cap',       params: { cap_pct: 2 } },
    ]),
  },

  {
    key: 'swing_trend',
    name: 'Swing Trend',
    category: 'swing',
    summary: 'EMA alignment + MACD cross. Holds days, R:R 2+.',
    pair_hint: 'GBPUSD',
    timeframe: '4h',
    config: build([
      { key: 'ema_alignment',  params: { fast: 21, slow: 55, direction: 'bull' } },
      { key: 'macd_cross',     params: { direction: 'up' } },
      { key: 'rsi_band',       params: { lower: 45, upper: 70 } },
      { key: 'engine_confidence', params: { min: 70 } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 1.0, sl_atr: 1.5, rr: 2.5 } },
    ]),
  },

  {
    key: 'breakout_volatility',
    name: 'Volatility Breakout',
    category: 'breakout',
    summary: 'Bollinger upper break with expanding ATR + session filter.',
    pair_hint: 'XAUUSD',
    timeframe: '1h',
    config: build([
      { key: 'session_window',       params: { sessions: 'london_ny' } },
      { key: 'atr_band',             params: { lower_pct: 55, upper_pct: 95 } },
      { key: 'bollinger_position',   params: { where: 'upper' } },
      { key: 'swing_break',          params: { lookback: 12, direction: 'high' } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 1.0, sl_atr: 1.5, rr: 2.5 } },
    ]),
  },

  {
    key: 'mean_reversion_band',
    name: 'Mean Reversion at Band',
    category: 'mean_reversion',
    summary: 'BB extreme + RSI oversold fade — only in ranging regime.',
    pair_hint: 'EURUSD',
    timeframe: '1h',
    config: build([
      { key: 'engine_regime_allow',  params: { regimes: 'ranging_only' } },
      { key: 'bollinger_position',   params: { where: 'lower' } },
      { key: 'rsi_band',             params: { lower: 20, upper: 35 } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 0.75, sl_atr: 1.2, rr: 1.5 } },
    ]),
  },

  {
    key: 'trend_following',
    name: 'Multi-EMA Trend Following',
    category: 'trend',
    summary: 'Long when 9 > 21 > 55 EMAs, exit on opposite cross. Engine confidence + ATR floor.',
    pair_hint: 'BTCUSDT',
    timeframe: '4h',
    config: build([
      { key: 'ema_alignment',        params: { fast: 9,  slow: 21, direction: 'bull' } },
      { key: 'ema_alignment',        params: { fast: 21, slow: 55, direction: 'bull' } },
      { key: 'atr_band',             params: { lower_pct: 25, upper_pct: 100 } },
      { key: 'engine_confidence',    params: { min: 65 } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 1.0, sl_atr: 1.5, rr: 3.0 } },
      { key: 'max_open_positions',   params: { cap: 3 } },
    ]),
  },

  {
    key: 'smart_money_ob',
    name: 'Smart Money Order Block',
    category: 'smart_money',
    summary: 'Tap of a fresh institutional order block + FVG confirmation.',
    pair_hint: 'XAUUSD',
    timeframe: '15m',
    config: build([
      { key: 'engine_regime_allow',  params: { regimes: 'trending_or_breakout' } },
      { key: 'order_block_tap',      params: { lookback: 36, min_displacement_atr: 1.8 } },
      { key: 'fair_value_gap',       params: { direction: 'either', min_gap_atr: 0.4 } },
      { key: 'session_window',       params: { sessions: 'london_ny' } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 0.75, sl_atr: 1.0, rr: 2.5 } },
    ]),
  },

  {
    key: 'liquidity_grab',
    name: 'PDH/PDL Liquidity Grab',
    category: 'liquidity',
    summary: 'Sweep of the prior day high or low + reversal.',
    pair_hint: 'EURUSD',
    timeframe: '15m',
    config: build([
      { key: 'liquidity_sweep',      params: { level: 'pdh_pdl', min_excursion_atr: 0.6 } },
      { key: 'engulfing_candle',     params: { direction: 'bear' } },
      { key: 'session_window',       params: { sessions: 'london_ny' } },
      { key: 'engine_confidence',    params: { min: 55 } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 0.75, sl_atr: 1.0, rr: 2.0 } },
    ]),
  },

  {
    key: 'london_open',
    name: 'London Open Momentum',
    category: 'session',
    summary: 'Trend-aligned momentum during the London open. Skip news windows.',
    pair_hint: 'GBPUSD',
    timeframe: '15m',
    config: build([
      { key: 'session_window',       params: { sessions: 'london' } },
      { key: 'block_news',           params: { minutes_before: 30, minutes_after: 30, impact: 'high' } },
      { key: 'ema_alignment',        params: { fast: 9, slow: 50, direction: 'bull' } },
      { key: 'macd_cross',           params: { direction: 'up' } },
      { key: 'fixed_risk_per_trade', params: { risk_pct: 1.0, sl_atr: 1.2, rr: 2.0 } },
    ]),
  },

] as const


export type TemplateKey = (typeof STRATEGY_TEMPLATES)[number]['key']

export const TEMPLATE_BY_KEY = Object.fromEntries(
  STRATEGY_TEMPLATES.map((t) => [t.key, t]),
) as Record<TemplateKey, StrategyTemplate>


/** Group templates for the template picker UI. */
export function groupedTemplates() {
  const groups = new Map<StrategyTemplate['category'], StrategyTemplate[]>()
  for (const t of STRATEGY_TEMPLATES) {
    if (!groups.has(t.category)) groups.set(t.category, [])
    groups.get(t.category)!.push(t)
  }
  return groups
}
