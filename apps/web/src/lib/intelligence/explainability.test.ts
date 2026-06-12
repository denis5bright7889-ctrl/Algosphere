/**
 * Explainability layer tests (Phase 8).
 *   node --experimental-strip-types --test src/lib/intelligence/explainability.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTrade } from './coach-eval.ts'
import { explainCoachEvaluation, explainEdge, explainDrawdown } from './explainability.ts'

test('empty trade explanation: value null, every axis listed as missing', () => {
  const ev = evaluateTrade({ pair: 'XAUUSD' })
  const { overall, axes } = explainCoachEvaluation({ pair: 'XAUUSD' }, ev)
  assert.equal(overall.value, null)
  assert.equal(overall.confidence, 'insufficient')
  assert.equal(overall.inputs_missing.length, 5)            // all 5 axes missing
  assert.ok(axes.every((a) => a.value == null))
  assert.ok(overall.formula.toLowerCase().includes('pnl never'))
})

test('full trade explanation: shows inputs used, formula, sample, confidence', () => {
  const input = {
    entry_quality: 'good', exit_quality: 'good', management_quality: 'good',
    emotion_pre: 'calm', reason_for_entry: 'strategy_signal', rule_compliance: 'full',
    risk_pct: 1.0, setup_validity: 'yes', strategy_used: 'trend_following', market_regime: 'trending',
  }
  const ev = evaluateTrade(input)
  const { overall, axes } = explainCoachEvaluation(input, ev)
  assert.ok(typeof overall.value === 'number')
  assert.equal(overall.confidence, 'high')
  assert.ok(overall.inputs_used.length >= 4)
  const risk = axes.find((a) => a.label === 'Risk')!
  assert.ok(risk.inputs_used.some((i) => i.name === 'risk_pct'))
  assert.ok(risk.formula.length > 0)
})

test('risk axis with no risk_pct → flagged missing + Insufficient', () => {
  const input = { emotion_pre: 'calm' }
  const ev = evaluateTrade(input)
  const { axes } = explainCoachEvaluation(input, ev)
  const risk = axes.find((a) => a.label === 'Risk')!
  assert.equal(risk.value, null)
  assert.ok(risk.inputs_missing.includes('risk_pct'))
  assert.equal(risk.confidence, 'insufficient')
})

test('edge explanation surfaces the 10-trade floor for weak samples', () => {
  const weak = explainEdge({ label: 'Pair · EURUSD', trades: 6, wins: 5, win_rate: 0.83, expectancy: 40, confidence: 'insufficient', verdict: 'Insufficient Evidence' })
  assert.ok(weak.notes!.some((n) => n.includes('10-trade')))
})

test('drawdown explanation discloses unknown-balance caveat', () => {
  const unknown = explainDrawdown({ maxDrawdownPct: 50, maxDrawdownUsd: 50, startingBalance: 0, trades: 5 })
  assert.equal(unknown.confidence, 'low')
  assert.ok(unknown.inputs_missing.includes('starting balance'))
  const known = explainDrawdown({ maxDrawdownPct: 13.6, maxDrawdownUsd: 150, startingBalance: 1000, trades: 20 })
  assert.equal(known.confidence, 'high')
  assert.equal(known.inputs_missing.length, 0)
})
