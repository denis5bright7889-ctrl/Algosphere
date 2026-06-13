/**
 * node --experimental-strip-types --test src/lib/intelligence/broker-truth-verify.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyBrokerTruth, isReconciled, worstDiscrepancy } from './broker-truth-verify.ts'

test('fully reconciled → no discrepancies', () => {
  const ds = verifyBrokerTruth(
    { trade_count: 30, balance: 15881, equity: 15727, open_positions: 1 },
    { trade_count: 30, balance: 15881.2, equity: 15727.1, open_positions: 1, equity_age_s: 30 },
  )
  assert.equal(isReconciled(ds), true)
  assert.equal(worstDiscrepancy(ds), null)
})

test('DB has more trades than broker → critical duplicate-ingestion flag', () => {
  const ds = verifyBrokerTruth({ trade_count: 30 }, { trade_count: 33 })
  assert.ok(ds.some((d) => d.field === 'trade_count' && d.severity === 'critical' && d.delta === 3))
})

test('DB missing broker trades → critical', () => {
  const ds = verifyBrokerTruth({ trade_count: 40 }, { trade_count: 30 })
  assert.ok(ds.some((d) => d.field === 'trade_count' && d.message.includes('MISSING')))
})

test('equity divergence beyond tolerance → high', () => {
  const ds = verifyBrokerTruth({ equity: 15727 }, { equity: 16500 })
  assert.ok(ds.some((d) => d.field === 'equity' && d.severity === 'high'))
})

test('stale stored equity → flagged, never silently used', () => {
  const ds = verifyBrokerTruth({ equity: 15727 }, { equity: 15727, equity_age_s: 7200 })
  assert.ok(ds.some((d) => d.field === 'equity_staleness'))
})

test('stale positions: DB open but broker closed → high', () => {
  const ds = verifyBrokerTruth({ open_positions: 0 }, { open_positions: 2 })
  assert.ok(ds.some((d) => d.field === 'open_positions' && d.message.includes('closed')))
})

test('missing side is a discrepancy, never an implicit match', () => {
  const ds = verifyBrokerTruth({ trade_count: 30 }, {})   // stored unknown
  assert.ok(ds.some((d) => d.field === 'trade_count' && d.message.includes('not comparable')))
})

test('the dormant-reconciler reality: broker truth unknown → flagged, not assumed OK', () => {
  // Both sides null on everything we cannot read → no false "reconciled".
  const ds = verifyBrokerTruth({ trade_count: 30 }, { trade_count: null })
  assert.equal(isReconciled(ds), false)
})
