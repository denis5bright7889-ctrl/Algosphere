/**
 * Edge confidence + sample-gating tests (Phase 6).
 *   node --experimental-strip-types --test src/lib/intelligence/edge-confidence.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { edgeConfidence, edgeVerdict, assessEdge, wilsonInterval } from './edge-confidence.ts'

test('confidence tiers by sample size', () => {
  assert.equal(edgeConfidence(0), 'insufficient')
  assert.equal(edgeConfidence(9), 'insufficient')
  assert.equal(edgeConfidence(10), 'low')
  assert.equal(edgeConfidence(19), 'low')
  assert.equal(edgeConfidence(20), 'medium')
  assert.equal(edgeConfidence(49), 'medium')
  assert.equal(edgeConfidence(50), 'high')
})

test('a small but profitable-looking sample is NEVER labeled profitable', () => {
  // 7 trades, strong positive expectancy → still Insufficient Evidence.
  assert.equal(assessEdge({ trades: 7, expectancy: 50, wins: 6 }).verdict, 'insufficient_evidence')
  assert.equal(edgeVerdict(50, edgeConfidence(7)), 'insufficient_evidence')
})

test('evidenced samples get a real verdict', () => {
  assert.equal(assessEdge({ trades: 25, expectancy: 30, wins: 16 }).verdict, 'profitable')
  assert.equal(assessEdge({ trades: 25, expectancy: -30, wins: 9 }).verdict, 'unprofitable')
})

test('wilson interval is bounded and sane', () => {
  const ci = wilsonInterval(6, 10)
  assert.ok(ci.low >= 0 && ci.high <= 1 && ci.low < ci.high)
  // a 6/10 win rate should have a wide CI (small sample)
  assert.ok(ci.high - ci.low > 0.4)
})

test('the gating boundary: 9 trades insufficient, 10 is the floor for a verdict', () => {
  assert.equal(assessEdge({ trades: 9, expectancy: 100, wins: 9 }).verdict, 'insufficient_evidence')
  assert.notEqual(assessEdge({ trades: 10, expectancy: 100, wins: 7 }).verdict, 'insufficient_evidence')
})
