/**
 * Drawdown regression tests (trust audit).
 *   node --experimental-strip-types --test src/lib/analytics/metrics.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMetrics, computeDrawdownCurve } from './metrics.ts'

test('drawdown never exceeds 100% (was 150% with peak-PnL denominator)', () => {
  // +100 then -150 → cumulative 100 then -50. Old code: 150/100 = 150%.
  const m = computeMetrics([100, -150], 1000)
  assert.ok(m.max_drawdown_pct <= 100, `expected ≤100, got ${m.max_drawdown_pct}`)
  // equity 1100 → 950, peak 1100 → 150/1100 = 13.64%
  assert.equal(m.max_drawdown_pct, 13.64)
  assert.equal(m.max_drawdown_usd, 150)
})

test('a trader losing from trade 1 shows real drawdown (was 0%)', () => {
  // All losses. Old code: peak stayed 0 → ddPct skipped → 0%.
  const m = computeMetrics([-20, -30, -40], 1000)   // equity 980,950,910; peak 1000
  assert.equal(m.max_drawdown_pct, 9)               // 90/1000
  assert.equal(m.max_drawdown_usd, 90)
})

test('unknown balance (0) stays bounded — never fabricates >100%', () => {
  const m = computeMetrics([100, -150])   // base 0: gave back all gains + more → clamps to 100
  assert.ok(m.max_drawdown_pct <= 100)
})

test('clean uptrend has zero drawdown', () => {
  const m = computeMetrics([10, 20, 15, 30], 1000)
  assert.equal(m.max_drawdown_pct, 0)
})

test('drawdown curve is equity-based and bounded', () => {
  const curve = computeDrawdownCurve([{ date: 'd1', pnl: 100 }, { date: 'd2', pnl: -150 }], 1000)
  assert.equal(curve[0]!.equity, 1100)
  assert.equal(curve[1]!.equity, 950)
  assert.ok(curve.every((p) => p.drawdown_pct >= -100 && p.drawdown_pct <= 0))
})
