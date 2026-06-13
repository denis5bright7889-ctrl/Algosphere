/**
 * node --experimental-strip-types --import ./scripts/register-ts.mjs --test \
 *   src/lib/analytics/broker-equity.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brokerEquityAnchor, formatAge } from './broker-equity.ts'

const NOW = Date.parse('2026-06-13T12:00:00Z')

test('picks the highest connected equity + its age', () => {
  const a = brokerEquityAnchor([
    { equity_usd: 5000, equity_updated_at: '2026-06-13T11:59:30Z' },
    { equity_usd: 15727, equity_updated_at: '2026-06-13T11:55:00Z' },
  ], NOW)
  assert.equal(a.equity, 15727)
  assert.equal(a.ageSeconds, 300)   // 5 minutes
})

test('no connected equity → undefined, null age (never a fabricated anchor)', () => {
  assert.deepEqual(brokerEquityAnchor([], NOW), { equity: undefined, ageSeconds: null })
  assert.deepEqual(brokerEquityAnchor([{ equity_usd: 0 }, { equity_usd: null }], NOW), { equity: undefined, ageSeconds: null })
})

test('missing timestamp → null age (cannot claim freshness)', () => {
  const a = brokerEquityAnchor([{ equity_usd: 1000 }], NOW)
  assert.equal(a.equity, 1000)
  assert.equal(a.ageSeconds, null)
})

test('stale reading produces a large age that the engine will flag', () => {
  const a = brokerEquityAnchor([{ equity_usd: 1000, equity_updated_at: '2026-06-13T08:18:00Z' }], NOW)
  assert.ok(a.ageSeconds! > 1800, 'older than the 30m budget')
  assert.equal(formatAge(a.ageSeconds), '3h 42m')
})

test('formatAge buckets', () => {
  assert.equal(formatAge(30), '30s')
  assert.equal(formatAge(120), '2m')
  assert.equal(formatAge(3600), '1h 0m')
  assert.equal(formatAge(null), 'unknown age')
})
