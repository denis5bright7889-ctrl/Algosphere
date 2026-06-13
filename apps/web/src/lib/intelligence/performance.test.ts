/**
 * Performance drawdown regression tests.
 *   node --experimental-strip-types --test src/lib/intelligence/performance.test.ts
 *
 * Guards the 3509%-drawdown bug: PnL-relative DD against a near-zero early
 * peak produced absurd percentages. DD must be equity-relative when account
 * equity is known, and clamped to [0,1] when it isn't.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzePerformance } from './performance.ts'

// A trader who books a tiny early win (peak ≈ $4), then a string of losses
// down to −$154 net. The old code did maxDd/peak = ~158/4 ≈ 3900%.
function bugScenario() {
  const pnls = [4.4, -8, -12, -10, -15, -9, -20, -11, -14, -7, -13, -6, -10, -8, -15.4]
  const base = Date.parse('2026-05-01T00:00:00Z')
  return pnls.map((pnl, i) => ({
    id: String(i), user_id: 'u', pnl,
    created_at: new Date(base + i * 3_600_000).toISOString(),
    trade_date: '2026-05-01',
  })) as unknown as Parameters<typeof analyzePerformance>[0]
}

test('drawdown is never >100% even with no account equity (clamped)', () => {
  const p = analyzePerformance(bugScenario())
  assert.ok(p.max_drawdown_pct != null)
  assert.ok(p.max_drawdown_pct <= 1, `expected ≤1, got ${p.max_drawdown_pct}`)
  assert.ok(p.max_drawdown_pct >= 0)
})

test('with real account equity, drawdown is a sane fraction of equity', () => {
  // ~$16k account; the ~$154 peak-to-trough is ~1% of equity, not 3509%.
  const p = analyzePerformance(bugScenario(), 15_727)
  assert.ok(p.max_drawdown_pct != null && p.max_drawdown_pct < 0.05,
    `expected <5%, got ${(p.max_drawdown_pct! * 100).toFixed(1)}%`)
})

test('empty / no-loss series → null drawdown, not a fabricated number', () => {
  assert.equal(analyzePerformance([]).max_drawdown_pct, null)
})
