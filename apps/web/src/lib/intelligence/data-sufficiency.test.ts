/**
 * node --experimental-strip-types --test src/lib/intelligence/data-sufficiency.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessSufficiency, hasSufficientData, MIN_SAMPLE } from './data-sufficiency.ts'

test('below floor → insufficient, never a score', () => {
  const r = assessSufficiency('win_rate', 5)   // floor 20
  assert.equal(r.status, 'insufficient')
  assert.equal(r.min, 20)
  assert.equal(r.have, 5)
  assert.ok(r.reason && r.reason.includes('20'))
})

test('at/above floor → ok', () => {
  assert.equal(assessSufficiency('edge', 10).status, 'ok')      // floor 10
  assert.equal(assessSufficiency('edge', 25).status, 'ok')
  assert.equal(hasSufficientData('setup', 9), false)            // floor 10
  assert.equal(hasSufficientData('setup', 10), true)
})

test('non-finite / negative have → treated as 0', () => {
  assert.equal(assessSufficiency('psychology', NaN).have, 0)
  assert.equal(assessSufficiency('psychology', -4).have, 0)
})

test('registry carries the spec thresholds', () => {
  assert.equal(MIN_SAMPLE.win_rate, 20)
  assert.equal(MIN_SAMPLE.edge, 10)
  assert.equal(MIN_SAMPLE.setup, 10)
  assert.equal(MIN_SAMPLE.psychology, 20)
  assert.equal(MIN_SAMPLE.timing, 10)
})
