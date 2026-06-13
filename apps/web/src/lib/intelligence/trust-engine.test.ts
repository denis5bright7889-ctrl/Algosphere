/**
 * node --experimental-strip-types --test src/lib/intelligence/trust-engine.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrust, isTrustworthy, type BuildTrustArgs } from './trust-engine.ts'

test('sufficient sample + value → scored, with confidence + explanation', () => {
  const t = buildTrust({ metric_id: 'win_rate', value: 62, sample_size: 120, min_sample: 20,
    assurance: 'Objective', evidence_count: 120, formula: 'wins/closed' })
  assert.equal(t.value, 62)
  assert.notEqual(t.confidence, 'Insufficient')
  assert.ok(t.explanation.length > 0)
  assert.equal(t.trust_level, 'Verified')   // objective + high + strong
  assert.equal(isTrustworthy(t), true)
})

test('below floor → Insufficient, value null, Very Low, never positive', () => {
  const t = buildTrust({ metric_id: 'win_rate', value: 100, sample_size: 4, min_sample: 20 })
  assert.equal(t.value, null)
  assert.equal(t.confidence, 'Insufficient')
  assert.equal(t.trust_level, 'Very Low')
  assert.ok(t.explanation.includes('Insufficient'))
  assert.equal(isTrustworthy(t), false)
})

test('null value → Insufficient regardless of sample', () => {
  const t = buildTrust({ metric_id: 'x', value: null, sample_size: 999, min_sample: 10 })
  assert.equal(t.confidence, 'Insufficient')
  assert.equal(t.value, null)
})

test('self-reported caps at Medium even with a large sample', () => {
  const t = buildTrust({ metric_id: 'discipline', value: 90, sample_size: 500, min_sample: 8,
    assurance: 'Self-Reported', evidence_count: 50 })
  assert.equal(t.confidence, 'High')
  assert.equal(t.trust_level, 'Medium')   // never High/Verified for self-reported
})

// CI INVARIANT: no TrustResult may ever lack a confidence or an explanation.
test('INVARIANT: every result carries a confidence AND a non-empty explanation', () => {
  const matrix: BuildTrustArgs[] = [
    { metric_id: 'a', value: null, sample_size: 0, min_sample: 10 },
    { metric_id: 'b', value: 50, sample_size: 10, min_sample: 10, assurance: 'Mixed' },
    { metric_id: 'c', value: 0, sample_size: 1000, min_sample: 20, assurance: 'Objective', evidence_count: 0 },
    { metric_id: 'd', value: 100, sample_size: 5, min_sample: 4, assurance: 'Self-Reported' },
  ]
  for (const args of matrix) {
    const t = buildTrust(args)
    assert.ok(['Insufficient', 'Low', 'Medium', 'High'].includes(t.confidence), `confidence missing for ${args.metric_id}`)
    assert.ok(typeof t.explanation === 'string' && t.explanation.trim().length > 0, `explanation missing for ${args.metric_id}`)
  }
})
