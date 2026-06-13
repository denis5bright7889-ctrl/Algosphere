/**
 * node --experimental-strip-types --import ./scripts/register-ts.mjs --test \
 *   src/lib/analytics/drawdown.test.ts
 *
 * Phase 10A — single source of truth + B2 (outlier guard) + B5 (staleness).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAccountDrawdown } from './drawdown.ts'
import { computeMetrics } from './metrics.ts'
import { analyzePerformance } from '../intelligence/performance.ts'

const PNLS = [4.4, -8, -12, -10, -15, -9, -20, -11, -14, -7, -13, -6, -10, -8, -15.4]

test('equity known → equity-relative, status ok, sane %', () => {
  const dd = computeAccountDrawdown(PNLS, { accountEquity: 15727 })
  assert.equal(dd.status, 'ok')
  assert.ok(dd.max_drawdown_pct < 0.05, `expected <5%, got ${(dd.max_drawdown_pct * 100).toFixed(2)}%`)
})

test('equity unknown → pnl_relative, clamped ≤100%', () => {
  const dd = computeAccountDrawdown(PNLS, {})
  assert.equal(dd.status, 'pnl_relative')
  assert.ok(dd.max_drawdown_pct <= 1)
})

test('B2: a single outlier pnl is clamped, peak not inflated', () => {
  const withSpike = [10, -8, 12, -9, 11, -7, 100000, -10, 9, -8, 11, -9]
  const dd = computeAccountDrawdown(withSpike, {})
  assert.ok(dd.outliers_clamped >= 1, 'should clamp the 100000 outlier')
  // Without clamping, peak ≈ 100k and a later dip reads as a huge $ drawdown.
  assert.ok(dd.peak_equity < 1000, `peak should not be inflated by the spike, got ${dd.peak_equity}`)
})

test('B5: stale equity → status stale, equity anchor NOT trusted', () => {
  const fresh = computeAccountDrawdown(PNLS, { accountEquity: 15727, equityAgeSeconds: 30 })
  const stale = computeAccountDrawdown(PNLS, { accountEquity: 15727, equityAgeSeconds: 7200 })
  assert.equal(fresh.status, 'ok')
  assert.equal(stale.status, 'stale')
  // Stale falls back to PnL-relative (does not silently use stale equity).
  assert.notEqual(stale.max_drawdown_pct, fresh.max_drawdown_pct)
})

test('empty series → insufficient, zeros', () => {
  const dd = computeAccountDrawdown([], { accountEquity: 1000 })
  assert.equal(dd.status, 'insufficient')
  assert.equal(dd.max_drawdown_pct, 0)
})

// ── THE 10A GUARANTEE: every surface returns the SAME drawdown ──────────
test('metrics.ts and performance.ts agree with the canonical engine', () => {
  const accountEquity = 15727
  const netPnl = PNLS.reduce((s, p) => s + p, 0)
  const startingBalance = accountEquity - netPnl

  const canonical = computeAccountDrawdown(PNLS, { accountEquity }).max_drawdown_pct  // 0..1

  // performance.ts consumes accountEquity directly.
  const entries = PNLS.map((pnl, i) => ({
    id: String(i), user_id: 'u', pnl,
    created_at: new Date(Date.parse('2026-05-01T00:00:00Z') + i * 3_600_000).toISOString(),
  })) as unknown as Parameters<typeof analyzePerformance>[0]
  const perf = analyzePerformance(entries, accountEquity).max_drawdown_pct  // 0..1

  // metrics.ts consumes startingBalance; returns 0..100.
  const met = computeMetrics(PNLS, startingBalance).max_drawdown_pct / 100  // → 0..1

  assert.ok(perf != null)
  assert.ok(Math.abs((perf as number) - canonical) < 1e-9, `performance ${perf} vs canonical ${canonical}`)
  assert.ok(Math.abs(met - canonical) < 0.005, `metrics ${met} vs canonical ${canonical}`)
})
