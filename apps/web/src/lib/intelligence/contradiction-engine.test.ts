/**
 * node --experimental-strip-types --test src/lib/intelligence/contradiction-engine.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectContradictions, worstSeverity } from './contradiction-engine.ts'

test('R1 PF<0.5 & score>70', () => {
  const c = detectContradictions({ profit_factor: 0.10, overall_score: 77 })
  assert.ok(c.some((x) => x.code === 'PF_LOW_SCORE_HIGH' && x.severity === 'critical'))
})

test('R2 no edge & rated Strong', () => {
  const c = detectContradictions({ verified_edge: false, rating: 'Strong' })
  assert.ok(c.some((x) => x.code === 'NO_EDGE_RATED_STRONG'))
})

test('R3 low setup coverage & high discipline', () => {
  const c = detectContradictions({ setup_coverage: 0.03, discipline: 100 })
  assert.ok(c.some((x) => x.code === 'LOW_SETUP_HIGH_DISCIPLINE'))
})

test('R4 net loss & high coaching confidence', () => {
  const c = detectContradictions({ net_pnl: -154.52, coaching_confidence: 'high' })
  assert.ok(c.some((x) => x.code === 'NET_LOSS_HIGH_COACH_CONF'))
})

test('R5 impulse>80 & discipline>80', () => {
  const c = detectContradictions({ impulse_risk: 100, discipline: 100 })
  assert.ok(c.some((x) => x.code === 'IMPULSE_HIGH_DISCIPLINE_HIGH' && x.severity === 'critical'))
})

test('clean facts → zero contradictions', () => {
  const c = detectContradictions({
    profit_factor: 1.8, overall_score: 72, rating: 'Strong', verified_edge: true,
    setup_coverage: 0.9, discipline: 85, net_pnl: 2200, coaching_confidence: 'medium', impulse_risk: 10,
  })
  assert.equal(c.length, 0)
  assert.equal(worstSeverity(c), null)
})

test('the real-user snapshot trips multiple critical contradictions', () => {
  // 30 closed, PF 0.10, no edge, 30/31 no setup_tag, discipline 100, impulse 100.
  const c = detectContradictions({
    profit_factor: 0.10, overall_score: 77, rating: 'Steady', verified_edge: false,
    setup_coverage: 1 / 31, discipline: 100, net_pnl: -154.52, impulse_risk: 100,
  })
  assert.ok(c.length >= 3, `expected ≥3 contradictions, got ${c.length}`)
  assert.equal(worstSeverity(c), 'critical')
})

test('missing fields are skipped, not assumed', () => {
  // Only PF present → cannot evaluate score-based rules → no false contradiction.
  assert.equal(detectContradictions({ profit_factor: 0.1 }).length, 0)
})
