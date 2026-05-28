/**
 * Decision Brain — adaptive weighting layer (L3).
 *
 * Two parts, both honest about what they are:
 *
 *  1. W0 — the baseline weight vector over the seven intelligence
 *     categories (the institutional prior). This is what the live brain
 *     uses today.
 *
 *  2. regimeAdaptedWeights() — a DETERMINISTIC regime-aware tilt of W0.
 *     This is genuine adaptation (the weight mix shifts with the
 *     environment) that needs NO training data and carries no drift risk:
 *     Accumulation favours Smart Money, Expansion favours Momentum,
 *     Distribution favours Whale Flow, a volatility spike favours
 *     Volatility + Regime. Transition is handled as a confidence cut in
 *     the brain, not a weight change.
 *
 * LEARNED weight adaptation (reward/penalise from realised outcomes) lives
 * in learning.ts as pure, governed functions — it is NOT auto-applied to
 * the live vector. Per docs/architecture/adaptive-intelligence.md, silent
 * auto-application risks drift / overfitting / concept-rot; activation is
 * gated and requires accumulated, labelled decision volume.
 */
import type { MarketState, MomentumState } from './config'

/** The seven institutional categories the brief weights. */
export type BriefEngine =
  | 'smart_money' | 'momentum' | 'whales' | 'regime'
  | 'internals' | 'correlations' | 'volatility'

export type WeightVector = Record<BriefEngine, number>

/** Baseline prior — the brief's W0 (sums to 1.0). */
export const W0: WeightVector = {
  smart_money:  0.25,
  momentum:     0.20,
  whales:       0.15,
  regime:       0.20,
  internals:    0.10,
  correlations: 0.05,
  volatility:   0.05,
}

/** Normalise any weight vector so the entries sum to 1 (0-sum → W0). */
export function normalizeWeights(w: WeightVector): WeightVector {
  const sum = Object.values(w).reduce((s, v) => s + Math.max(0, v), 0)
  if (sum <= 0) return { ...W0 }
  const out = {} as WeightVector
  for (const k of Object.keys(w) as BriefEngine[]) out[k] = Math.max(0, w[k]) / sum
  return out
}

/** Boost applied to the regime-favoured category before renormalisation. */
const TILT = 0.5

/**
 * Deterministic regime-aware weighting. Returns a NEW normalised vector;
 * does not mutate W0. `volExtreme` reflects a volatility spike.
 */
export function regimeAdaptedWeights(
  marketState: MarketState,
  momentumState: MomentumState,
  volExtreme: boolean,
): WeightVector {
  const w: WeightVector = { ...W0 }

  // Momentum phase → which engine leads.
  switch (momentumState) {
    case 'ACCUMULATION': w.smart_money *= 1 + TILT; break          // stealth positioning leads
    case 'EXPANSION':
    case 'TRENDING':     w.momentum    *= 1 + TILT; break          // trend leads
    case 'PARABOLIC':
    case 'EXHAUSTION':   w.whales      *= 1 + TILT; break          // distribution / whale exits lead
  }

  // Volatility spike → lean on volatility + regime reads.
  if (volExtreme) {
    w.volatility *= 1 + TILT * 1.2
    w.regime     *= 1 + TILT * 0.6
  }

  // Risk-off environment → regime + whales matter more (flight detection).
  if (marketState === 'RISK_OFF') {
    w.regime *= 1 + TILT * 0.4
    w.whales *= 1 + TILT * 0.3
  }

  return normalizeWeights(w)
}
