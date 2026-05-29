/**
 * AlgoSphereQuant — Autonomous execution arming constants & helpers.
 *
 * The CONSENT_DOC_VERSION is bumped whenever the spec-bound risk
 * disclosure copy changes. The engine refuses execution when the
 * caller's stored consent version is below this — forcing a fresh
 * acceptance flow on the next visit. Never decrement.
 *
 * Spec: docs/architecture/algo-execution-spec.md sections 2, 14.
 */

export const CONSENT_DOC_VERSION = 1

export const TRADING_MODES = ['conservative', 'balanced', 'aggressive', 'manual'] as const
export type TradingMode = (typeof TRADING_MODES)[number]

export function isTradingMode(value: unknown): value is TradingMode {
  return typeof value === 'string' && (TRADING_MODES as readonly string[]).includes(value)
}

/**
 * Mode → confidence-threshold + sizing-multiplier overrides.
 *
 * The engine reads these to scale the institutional confidence engine's
 * 0–100 score and the adaptive sizing pipeline. Centralised here so the
 * web app, signal engine, and audit copy never drift from one truth.
 *
 * `min_confidence`  — published threshold below which we refuse to
 *                     execute (spec section 5: <45 reject).
 * `size_multiplier` — additional multiplier on top of the regime /
 *                     adaptive multipliers in
 *                     risk_engine._adaptive_multiplier. < 1 means
 *                     smaller positions; > 1 means larger.
 * `requires_user_approval` — Manual mode generates signals but holds
 *                            them in the approval queue rather than
 *                            firing /execute.
 */
export const MODE_OVERRIDES: Record<TradingMode, {
  min_confidence: number
  size_multiplier: number
  requires_user_approval: boolean
  label: string
  blurb: string
}> = {
  conservative: {
    min_confidence:         70,
    size_multiplier:        0.6,
    requires_user_approval: false,
    label: 'Conservative',
    blurb: 'Higher confidence required, reduced size, strict regime filtering.',
  },
  balanced: {
    min_confidence:         55,
    size_multiplier:        1.0,
    requires_user_approval: false,
    label: 'Balanced',
    blurb: 'Default institutional mode. Spec-aligned thresholds.',
  },
  aggressive: {
    min_confidence:         45,
    size_multiplier:        1.4,
    requires_user_approval: false,
    label: 'Aggressive',
    blurb: 'Wider signal acceptance, expanded risk budget. Use after a clean shadow record.',
  },
  manual: {
    min_confidence:         45,
    size_multiplier:        1.0,
    requires_user_approval: true,
    label: 'Manual approval',
    blurb: 'Signals are generated automatically but require your tap to fire.',
  },
}
