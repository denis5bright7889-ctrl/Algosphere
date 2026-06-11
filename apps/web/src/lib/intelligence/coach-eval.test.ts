/**
 * Coach evaluator trust-audit regression tests (EVALUATOR_VERSION 3).
 *   node --experimental-strip-types --test src/lib/intelligence/coach-eval.test.ts
 *
 * Cardinal rule under test: missing data is NEVER scored as positive behavior.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTrade, gradeForScore } from './coach-eval.ts'

test('EMPTY trade → Insufficient Data, not a 56/"C"', () => {
  const e = evaluateTrade({ pair: 'XAUUSD', direction: 'buy' })   // no behavioral fields
  assert.equal(e.quality_score, null)            // was 56 before the fix
  assert.equal(e.strategy_grade, null)
  assert.equal(e.confidence, 'insufficient')
  assert.equal(e.data_completeness, 0)
  assert.equal(e.execution_grade, null)
  assert.equal(e.psychology_grade, null)
  assert.equal(e.risk_grade, null)
  assert.equal(e.discipline_grade, null)
  assert.equal(e.timing_grade, null)
  assert.ok(e.ai_insights.some((s) => s.toLowerCase().includes('insufficient')))
})

test('missing risk is never a passing score (fails closed)', () => {
  // Only psychology logged; risk_pct absent → risk_grade must be null, not 54.
  const e = evaluateTrade({ emotion_pre: 'calm', reason_for_entry: 'strategy_signal' })
  assert.equal(e.risk_grade, null)
  assert.equal(e.confidence, 'low')              // 1 axis
})

test('partial logging → low/medium confidence, only logged axes scored', () => {
  const e = evaluateTrade({ risk_pct: 1.0, setup_validity: 'yes' })  // risk + timing
  assert.equal(e.confidence, 'medium')           // 2 axes
  assert.ok(e.risk_grade != null && e.timing_grade != null)
  assert.equal(e.psychology_grade, null)
  assert.equal(e.execution_grade, null)
  assert.equal(e.data_completeness, 0.4)
})

test('fully logged trade → high confidence + real grade', () => {
  const e = evaluateTrade({
    entry_quality: 'good', exit_quality: 'good', management_quality: 'good',
    emotion_pre: 'calm', reason_for_entry: 'strategy_signal', revenge_trade: false,
    rule_compliance: 'full', confidence_level: 7,
    risk_pct: 1.0, setup_validity: 'yes', market_regime: 'trending', strategy_used: 'trend_following',
    session: 'london',
  })
  assert.equal(e.confidence, 'high')             // 5 axes
  assert.equal(e.data_completeness, 1)
  assert.ok(typeof e.quality_score === 'number' && e.quality_score >= 70)
  assert.ok(e.strategy_grade === 'A' || e.strategy_grade === 'B')
})

test('disciplined LOSING trade still grades on process (PnL excluded)', () => {
  const e = evaluateTrade({
    entry_quality: 'excellent', management_quality: 'good', exit_quality: 'good',
    emotion_pre: 'calm', reason_for_entry: 'strategy_signal', rule_compliance: 'full',
    risk_pct: 1.0, setup_validity: 'yes', strategy_used: 'trend_following', market_regime: 'trending',
    pnl: -120,
  })
  assert.ok((e.quality_score ?? 0) >= 75)        // good process despite the loss
  assert.ok(e.ai_insights.some((s) => s.toLowerCase().includes('losing trade')))
})

test('overconfidence + oversize is penalised, not rewarded', () => {
  const e = evaluateTrade({
    risk_pct: 4, setup_validity: 'no', confidence_level: 9,
    emotion_pre: 'excited', reason_for_entry: 'fomo', rule_compliance: 'none',
  })
  assert.ok((e.risk_grade ?? 100) < 45)
  assert.ok((e.psychology_grade ?? 100) < 45)
  assert.equal(e.emotional_flag, true)
})

test('unified grade scale (single source of truth)', () => {
  assert.equal(gradeForScore(90), 'A')
  assert.equal(gradeForScore(72), 'B')
  assert.equal(gradeForScore(56), 'C')
  assert.equal(gradeForScore(41), 'D')
  assert.equal(gradeForScore(20), 'F')
  assert.equal(gradeForScore(null), null)
  assert.equal(gradeForScore(undefined), null)
})
