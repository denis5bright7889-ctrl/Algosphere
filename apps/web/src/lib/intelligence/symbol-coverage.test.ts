/**
 * Symbol Coverage analyzer tests.
 *   node --experimental-strip-types --test src/lib/intelligence/symbol-coverage.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSymbolCoverage, type SymbolEvent } from './symbol-coverage.ts'

const NOW = Date.parse('2026-06-05T12:00:00Z')
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

function run(events: SymbolEvent[], universe: string[], scans: Record<string, string> = {}) {
  return analyzeSymbolCoverage({ universe, events, lastScanBySymbol: scans, now: NOW, windowDays: 7 })
}

test('classifies active / filtered / never / dormant / degraded', () => {
  const events: SymbolEvent[] = [
    { surface: 'signal_generated', symbol: 'XAUUSD', reason: null, at: ago(2) },        // active
    { surface: 'signal_rejected',  symbol: 'EURUSD', reason: 'gate_blocked', at: ago(3) }, // filtered
    { surface: 'signal_rejected',  symbol: 'EURUSD', reason: 'gate_blocked', at: ago(5) },
    { surface: 'signal_generated', symbol: 'BTCUSDT', reason: null, at: ago(48) },       // dormant (2d ago)
  ]
  const r = run(events, ['XAUUSD', 'EURUSD', 'BTCUSDT', 'GBPUSD'], { GBPUSD: ago(1) })
  const m = Object.fromEntries(r.symbols.map((s) => [s.symbol, s]))

  assert.equal(m.XAUUSD!.classification, 'active')
  assert.equal(m.EURUSD!.classification, 'filtered')
  assert.equal(m.EURUSD!.top_reason, 'gate_blocked')
  assert.equal(m.BTCUSDT!.classification, 'dormant')
  assert.equal(m.GBPUSD!.classification, 'degraded')   // scanned <24h, no decision logged
})

test('symbol with no telemetry at all is "never" (not hidden)', () => {
  const r = run([], ['NAS100'])
  assert.equal(r.symbols[0]!.classification, 'never')
  assert.equal(r.summary.never, 1)
})

test('signal older than window → inactive', () => {
  const r = run([{ surface: 'signal_generated', symbol: 'USDJPY', reason: null, at: ago(24 * 9) }], ['USDJPY'])
  assert.equal(r.symbols[0]!.classification, 'inactive')
})

test('summary counts + worst-first ordering', () => {
  const events: SymbolEvent[] = [
    { surface: 'signal_generated', symbol: 'A', reason: null, at: ago(1) },
    { surface: 'signal_skipped',   symbol: 'B', reason: 'insufficient_bars', at: ago(1) },
  ]
  const r = run(events, ['A', 'B', 'C'])  // C = never
  assert.equal(r.universe_size, 3)
  assert.equal(r.summary.active, 1)
  assert.equal(r.summary.filtered, 1)
  assert.equal(r.summary.never, 1)
  // worst-first: never before filtered before active
  assert.equal(r.symbols[0]!.classification, 'never')
  assert.equal(r.symbols[r.symbols.length - 1]!.classification, 'active')
})

test('events for a symbol outside the universe are still included', () => {
  const r = run([{ surface: 'signal_generated', symbol: 'SOLUSDT', reason: null, at: ago(1) }], [])
  assert.ok(r.symbols.some((s) => s.symbol === 'SOLUSDT' && s.classification === 'active'))
})
