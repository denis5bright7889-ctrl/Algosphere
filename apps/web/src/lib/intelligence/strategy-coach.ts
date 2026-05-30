/**
 * Strategy Coach — block-aware, post-backtest recommendations.
 *
 * Slice 1 of the Strategy Intelligence layer. Reads the existing
 * deterministic StrategyAnalysis (from `gradeStrategy`) plus the
 * user's strategy config and produces specific, actionable
 * block-level suggestions:
 *
 *   ● "Drop the RSI Band filter — your strategy generates too few
 *      signals (only 4 trades)."
 *   ● "Reduce Risk per trade from 2.0 % to 1.0 % — max drawdown is
 *      36 %, current sizing is unsurvivable."
 *   ● "Add an ATR Regime filter — edge stability collapsed in the
 *      second half of the sample."
 *
 * Pure deterministic logic. No LLM calls, no schema change. The
 * coach NEVER contradicts the underlying diagnostic — every rule is
 * gated on the same evidence the diagnostic uses, then layered with
 * config-aware specificity (which block to touch, which param, what
 * target value).
 *
 * Use the output as a complement to the existing StrategyDiagnostics
 * panel: the diagnostics tell the user WHAT is wrong; the coach
 * tells them WHICH BLOCK to edit and HOW.
 */
import type { BacktestResult } from '@/lib/backtest'
import type { StrategyConfig, BlockInstance } from '@/lib/strategies/blocks'
import { BLOCK_BY_KEY } from '@/lib/strategies/blocks'
import {
  gradeStrategy,
  type StrategyAnalysis,
  type StrategyDiagnostic,
} from './strategy-grader'

export type CoachActionKind =
  | 'remove_filter'
  | 'add_filter'
  | 'tighten_filter'
  | 'widen_filter'
  | 'reduce_risk'
  | 'tighten_stop'
  | 'change_session'
  | 'increase_window'
  | 'all_clear'

export interface CoachAction {
  kind:        CoachActionKind
  /** Drives the icon + colour. */
  severity:    'critical' | 'warn' | 'info' | 'good'
  title:       string
  rationale:   string
  /** When set, points the user at the specific block (and optionally
   *  the param) they should change in /quant-builder. */
  block_target?: {
    block_key:   string
    block_label: string
    param_key?:  string
    param_label?: string
    current?:    number | string | boolean
    suggested?:  number | string | boolean
  }
}

export interface CoachReport {
  /** True when at least one fire-worthy condition was found OR the
   *  strategy is in a healthy state — i.e. the panel should render. */
  has_signal: boolean
  actions:    CoachAction[]
  /** Surfaced verbatim so the UI can show the analysis it was based
   *  on without re-running gradeStrategy. */
  analysis:   StrategyAnalysis
}

const FILTER_SCOPES = new Set(['filter'])

function isUserConfig(c?: StrategyConfig | null): c is StrategyConfig {
  return !!c && Array.isArray(c.blocks) && c.blocks.length > 0
}

function findBlock(cfg: StrategyConfig, key: string): BlockInstance | undefined {
  return cfg.blocks.find((b) => b.key === key)
}

function filterBlocks(cfg: StrategyConfig): BlockInstance[] {
  return cfg.blocks.filter((b) => {
    const def = BLOCK_BY_KEY[b.key as keyof typeof BLOCK_BY_KEY]
    return def && FILTER_SCOPES.has(def.scope)
  })
}

function hasDiag(diags: StrategyDiagnostic[], kind: StrategyDiagnostic['kind']): boolean {
  return diags.some((d) => d.kind === kind)
}

export function coachStrategy(
  result:  BacktestResult,
  config?: StrategyConfig | null,
): CoachReport {
  const analysis = gradeStrategy(result)
  const diags    = analysis.diagnostics
  const actions: CoachAction[] = []

  // ── Sample too thin: tell them to run a longer backtest before
  //    trusting any other recommendation. Always first if it fires.
  if (hasDiag(diags, 'thin_sample')) {
    actions.push({
      kind:      'increase_window',
      severity:  'warn',
      title:     'Backtest a longer window',
      rationale: `Only ${analysis.metrics.trades} trade${analysis.metrics.trades === 1 ? '' : 's'} observed — below 30 nothing about this strategy is statistically meaningful. Increase the bar count or pick a longer symbol history before iterating on filters.`,
    })
  }

  // ── Config-blind branch: if there is no user config (built-in
  //    strategy_type), we can still emit the increase_window action
  //    above and the all-clear below, but the block-level rules
  //    require knowing which blocks the strategy actually uses.
  if (!isUserConfig(config)) {
    // Healthy → still render an explicit all-clear so the user can
    // see the coach considered them.
    if (
      hasDiag(diags, 'positive_edge') &&
      !diags.some((d) => d.severity === 'critical' || d.severity === 'warn')
    ) {
      actions.push({
        kind:      'all_clear',
        severity:  'good',
        title:     'Edge looks healthy',
        rationale: 'Profit factor, expectancy, and drawdown are all within the safe band. Validate on a different symbol or recent window before going live.',
      })
    }
    return { has_signal: actions.length > 0, actions, analysis }
  }

  const cfg     = config
  const filters = filterBlocks(cfg)
  const risk    = findBlock(cfg, 'risk_per_trade')
  const session = findBlock(cfg, 'session_window')
  const atr     = findBlock(cfg, 'atr_regime')
  const rsi     = findBlock(cfg, 'rsi_band')

  // ── Over-filtered → drop a filter.
  if (hasDiag(diags, 'low_trade_frequency') && filters.length >= 2) {
    // The "most restrictive" filter is the last-added one — append-only
    // version history means later filters reduce the surviving signal
    // count. Suggest the LAST filter so the user can A/B test.
    const drop = filters[filters.length - 1]!
    actions.push({
      kind:      'remove_filter',
      severity:  'warn',
      title:     `Drop the "${BLOCK_BY_KEY[drop.key as keyof typeof BLOCK_BY_KEY]?.label ?? drop.key}" filter`,
      rationale: `Trade frequency is ${formatFreq(analysis.metrics.trade_frequency_per_day)}. Strategy is over-filtered — removing the most restrictive gate is the cheapest way to recover signal density without touching entry logic.`,
      block_target: {
        block_key:   drop.key,
        block_label: BLOCK_BY_KEY[drop.key as keyof typeof BLOCK_BY_KEY]?.label ?? drop.key,
      },
    })
  }

  // ── No volatility filter + unstable edge → add ATR regime.
  if (!atr && (
    hasDiag(diags, 'unstable_edge') ||
    hasDiag(diags, 'fat_tail_dependence') ||
    hasDiag(diags, 'negative_edge')
  )) {
    actions.push({
      kind:      'add_filter',
      severity:  hasDiag(diags, 'negative_edge') ? 'critical' : 'warn',
      title:     'Add an ATR Regime filter',
      rationale: 'No volatility gate is active. The strategy is firing in dead-vol periods (where targets never get hit) and news-vol periods (where stops blow out). An ATR-in-band filter keeps entries to the productive volatility window.',
      block_target: {
        block_key:   'atr_regime',
        block_label: 'ATR Regime',
      },
    })
  }

  // ── Wide RSI band + low edge → tighten band.
  if (rsi && hasDiag(diags, 'negative_edge')) {
    const lower = Number(rsi.params['lower'] ?? 40)
    const upper = Number(rsi.params['upper'] ?? 70)
    if (upper - lower >= 50) {
      actions.push({
        kind:      'tighten_filter',
        severity:  'warn',
        title:     'Tighten the RSI band',
        rationale: `Your RSI band spans ${lower}–${upper} (${upper - lower} points) — that's nearly the full range, so it isn't actually filtering. Tighten to 30–70 or 40–60 to gate out the noise zone.`,
        block_target: {
          block_key:   'rsi_band',
          block_label: 'RSI in band',
          param_key:   'upper',
          param_label: 'Upper / Lower',
          current:     `${lower}–${upper}`,
          suggested:   '40–60',
        },
      })
    }
  }

  // ── Risk too high → reduce risk_pct.
  if (risk && (hasDiag(diags, 'excessive_dd') || hasDiag(diags, 'fat_tail_dependence'))) {
    const cur = Number(risk.params['risk_pct'] ?? 1)
    if (cur > 1.0) {
      const target = cur >= 2 ? 1.0 : 0.5
      actions.push({
        kind:      'reduce_risk',
        severity:  result.maxDrawdownPct >= 0.30 ? 'critical' : 'warn',
        title:     `Reduce risk per trade from ${cur.toFixed(1)}% to ${target.toFixed(1)}%`,
        rationale: `Max drawdown is ${(result.maxDrawdownPct * 100).toFixed(1)}%. At ${cur.toFixed(1)}% sizing the equity curve is in the unsurvivable band — a 2-sigma streak compounds into a blow-up. Halving the risk preserves the edge while making the strategy actually trade-able.`,
        block_target: {
          block_key:   'risk_per_trade',
          block_label: 'Risk per trade',
          param_key:   'risk_pct',
          param_label: 'Risk %',
          current:     cur,
          suggested:   target,
        },
      })
    }
  }

  // ── Stops too wide → tighten SL multiplier.
  if (risk && hasDiag(diags, 'poor_rr_dist')) {
    const slAtr = Number(risk.params['sl_atr'] ?? 1.2)
    if (slAtr > 1.5) {
      actions.push({
        kind:      'tighten_stop',
        severity:  'warn',
        title:     `Tighten SL from ${slAtr.toFixed(1)}× ATR to 1.0–1.2× ATR`,
        rationale: 'Your stops are wide enough that the R:R distribution is asymmetric — losers are larger than the winners support. Tighter stops will increase the stop-out rate slightly but compress the loss distribution and lift profit factor.',
        block_target: {
          block_key:   'risk_per_trade',
          block_label: 'Risk per trade',
          param_key:   'sl_atr',
          param_label: 'SL = N × ATR',
          current:     slAtr,
          suggested:   1.2,
        },
      })
    }
  }

  // ── No session gate + unstable edge → suggest London/NY.
  if (!session && hasDiag(diags, 'unstable_edge')) {
    actions.push({
      kind:      'change_session',
      severity:  'info',
      title:     'Limit entries to London + New York sessions',
      rationale: "Edge isn't stable across the sample. Most of the noise comes from Asia / off-hours where liquidity is thin and breakouts fake out. Restricting to the London-NY window typically cleans up the equity curve at the cost of fewer trades.",
      block_target: {
        block_key:   'session_window',
        block_label: 'Session window',
        param_key:   'sessions',
        param_label: 'Sessions',
        suggested:   'london_ny',
      },
    })
  }

  // ── Healthy state — explicit all-clear so the user sees the coach
  //    actually evaluated something instead of "no recommendations".
  if (
    actions.length === 0 &&
    hasDiag(diags, 'positive_edge') &&
    !diags.some((d) => d.severity === 'critical' || d.severity === 'warn')
  ) {
    actions.push({
      kind:      'all_clear',
      severity:  'good',
      title:     'Edge looks healthy',
      rationale: 'No actionable changes — profit factor, drawdown, and edge stability are all in the safe band. Validate on a different symbol or window before sizing live.',
    })
  }

  return { has_signal: actions.length > 0, actions, analysis }
}

function formatFreq(perDay: number | null): string {
  if (perDay == null || !Number.isFinite(perDay)) return 'too low to measure'
  if (perDay < 0.05)  return `~${(perDay * 30).toFixed(1)} trades / month`
  if (perDay < 1)     return `~${(perDay * 7).toFixed(1)} trades / week`
  return `${perDay.toFixed(1)} trades / day`
}
