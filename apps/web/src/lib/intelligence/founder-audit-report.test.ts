/**
 * node --experimental-strip-types --test src/lib/intelligence/founder-audit-report.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFounderAuditReport } from './founder-audit-report.ts'
import { buildTrust } from './trust-engine.ts'
import { detectContradictions } from './contradiction-engine.ts'

test('aggregates module trust, flags fabrication + missing-data, applies contradiction penalty', () => {
  const behavioral = [
    buildTrust({ metric_id: 'resilience', value: 80, sample_size: 60, min_sample: 8, assurance: 'Objective', evidence_count: 12 }),
    buildTrust({ metric_id: 'discipline', value: null, sample_size: 0, min_sample: 8 }),            // insufficient
    buildTrust({ metric_id: 'self_control', value: 90, sample_size: 30, min_sample: 8, assurance: 'Self-Reported', evidence_count: 5 }),
  ]
  const edge = [
    buildTrust({ metric_id: 'EURUSD', value: 30, sample_size: 6, min_sample: 10 }),                  // shown? no — insufficient → null
  ]
  const contradictions = detectContradictions({ profit_factor: 0.1, overall_score: 77, impulse_risk: 100, discipline: 100 })

  const report = buildFounderAuditReport({ modules: { behavioral, edge }, contradictions, now: new Date('2026-06-13T00:00:00Z') })

  // discipline (null) is a missing-data risk, not a fabrication.
  assert.ok(report.missing_data_risks.includes('behavioral.discipline'))
  // self_control is shown (90) but trust capped Medium — not a fabrication (Medium ok).
  // resilience Verified-ish; behavioral module has 2 scored.
  const beh = report.modules.find((m) => m.module === 'behavioral')!
  assert.equal(beh.scored, 2)
  assert.equal(beh.insufficient, 1)
  // contradiction penalty pulls platform trust down from the raw module mean.
  assert.ok(report.platform_trust_pct < 100)
  assert.ok(report.contradictions.length >= 2)
  assert.ok(report.confidence_levels.Insufficient >= 2)   // discipline + edge
})

test('platform trust never negative even under heavy contradictions', () => {
  const weak = [buildTrust({ metric_id: 'x', value: 50, sample_size: 8, min_sample: 8, assurance: 'Self-Reported' })]
  const many = detectContradictions({
    profit_factor: 0.1, overall_score: 99, rating: 'Strong', verified_edge: false,
    setup_coverage: 0.01, discipline: 100, net_pnl: -500, coaching_confidence: 'high', impulse_risk: 100,
  })
  const r = buildFounderAuditReport({ modules: { m: weak }, contradictions: many })
  assert.ok(r.platform_trust_pct >= 0)
})
