/**
 * Signal Quality analyzer tests.
 *   node --experimental-strip-types --test src/lib/intelligence/signal-quality.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSignalQuality, type QSignal, type QDecision } from './signal-quality.ts'

const sig = (pair: string, result: QSignal['result'], regime: string, conf: number): QSignal =>
  ({ pair, result, regime, confidence_score: conf })

test('computes per-symbol win rate, acceptance, and overall', () => {
  const signals: QSignal[] = [
    sig('XAUUSD', 'win', 'trending', 80), sig('XAUUSD', 'win', 'trending', 78), sig('XAUUSD', 'loss', 'trending', 60),
    sig('EURUSD', 'loss', 'ranging', 55), sig('EURUSD', 'win', 'ranging', 70),
  ]
  const decisions: QDecision[] = [
    { symbol: 'XAUUSD', generated: 3, rejected: 7, skipped: 0 },  // acceptance 0.30
    { symbol: 'EURUSD', generated: 2, rejected: 8, skipped: 0 },  // 0.20
  ]
  const r = analyzeSignalQuality({ signals, decisions, now: 0 })

  assert.equal(r.overall.closed, 5)
  assert.equal(r.overall.win_rate, 0.6)            // 3W/2L
  assert.equal(r.pnl_available, false)             // honest — no pnl yet

  const xau = r.per_symbol.find((s) => s.symbol === 'XAUUSD')!
  assert.equal(xau.win_rate, round(2 / 3))         // 2W/1L
  assert.equal(xau.acceptance_rate, 0.3)
  assert.equal(xau.avg_confidence, Math.round((80 + 78 + 60) / 3))
})

test('per-regime + per-confidence calibration grouping', () => {
  const signals: QSignal[] = [
    sig('A', 'win', 'trending', 90), sig('B', 'win', 'trending', 88),
    sig('C', 'loss', 'ranging', 56), sig('D', 'loss', 'ranging', 58),
  ]
  const r = analyzeSignalQuality({ signals, decisions: [], now: 0 })
  const trending = r.per_regime.find((g) => g.key === 'trending')!
  const ranging = r.per_regime.find((g) => g.key === 'ranging')!
  assert.equal(trending.win_rate, 1)
  assert.equal(ranging.win_rate, 0)
  assert.ok(r.per_confidence.some((g) => g.key === '85-100' && g.win_rate === 1))
  assert.ok(r.per_confidence.some((g) => g.key === '55-64' && g.win_rate === 0))
})

test('ranking requires a minimum closed sample', () => {
  const signals: QSignal[] = [
    sig('THIN', 'win', 'trending', 80),  // only 1 closed → excluded from rank
    sig('OK', 'win', 'trending', 80), sig('OK', 'win', 'trending', 80), sig('OK', 'loss', 'trending', 80),
  ]
  const r = analyzeSignalQuality({ signals, decisions: [], now: 0 })
  assert.ok(r.best_symbols.some((s) => s.symbol === 'OK'))
  assert.ok(!r.best_symbols.some((s) => s.symbol === 'THIN'))
})

function round(x: number) { return Math.round(x * 100) / 100 }
