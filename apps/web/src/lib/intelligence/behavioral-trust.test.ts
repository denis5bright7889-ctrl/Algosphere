/**
 * Behavioral measurement-trust model tests (Step 2).
 *   node --experimental-strip-types --test src/lib/intelligence/behavioral-trust.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBehavioralTrust, behavioralConfidence, assuranceFor, trustLevel, buildMetricTrust,
} from './behavioral-trust.ts'

test('confidence tiers by qualifying observations', () => {
  assert.equal(behavioralConfidence(0), 'Insufficient')
  assert.equal(behavioralConfidence(3), 'Insufficient')
  assert.equal(behavioralConfidence(4), 'Low')
  assert.equal(behavioralConfidence(9), 'Low')
  assert.equal(behavioralConfidence(10), 'Medium')
  assert.equal(behavioralConfidence(24), 'Medium')
  assert.equal(behavioralConfidence(25), 'High')
})

test('assurance classification', () => {
  assert.equal(assuranceFor('resilience'), 'Objective')
  assert.equal(assuranceFor('consistency'), 'Objective')
  assert.equal(assuranceFor('tilt'), 'Mixed')
  assert.equal(assuranceFor('rule_adherence'), 'Self-Reported')
  assert.equal(assuranceFor('fomo'), 'Self-Reported')
  assert.equal(assuranceFor('unknown_metric'), 'Mixed')   // safe default
})

test('trustLevel matrix — self-reported caps at Medium, objective+high = High', () => {
  assert.equal(trustLevel('High', 'Objective'), 'High')
  assert.equal(trustLevel('High', 'Self-Reported'), 'Medium')   // big sample can't beat soft data
  assert.equal(trustLevel('High', 'Mixed'), 'Medium')
  assert.equal(trustLevel('Medium', 'Objective'), 'Medium')
  assert.equal(trustLevel('Medium', 'Self-Reported'), 'Low')
  assert.equal(trustLevel('Low', 'Objective'), 'Low')
  assert.equal(trustLevel('Insufficient', 'Objective'), 'Insufficient')
})

test('buildMetricTrust: resilience (objective) vs rule-adherence (self-reported)', () => {
  const res = buildMetricTrust({ metric: 'resilience', value: 81, sample: 30, evidenceCount: 3 })
  assert.equal(res.confidence, 'High')
  assert.equal(res.assurance, 'Objective')
  assert.equal(res.trust_level, 'High')

  const rule = buildMetricTrust({ metric: 'rule_adherence', value: 87, sample: 30, evidenceCount: 0 })
  assert.equal(rule.confidence, 'High')
  assert.equal(rule.assurance, 'Self-Reported')
  assert.equal(rule.trust_level, 'Medium')               // capped despite n=30
  assert.ok(rule.verdict.includes('self-reported'))
})

test('null value → Insufficient regardless of sample', () => {
  const t = buildMetricTrust({ metric: 'self_control', value: null, sample: 40 })
  assert.equal(t.confidence, 'Insufficient')
  assert.equal(t.trust_level, 'Insufficient')
  assert.ok(t.verdict.toLowerCase().includes('insufficient'))
})

test('buildBehavioralTrust: opportunity-bounded sample (revenge ≠ total trades)', () => {
  // 30 closed trades but only 3 losses → revenge confidence is Insufficient
  // (3 post-loss opportunities), while resilience (window sample 30) is High.
  const r = {
    closed_trades: 30, wins_count: 27, losses_count: 3,
    consistency_score: 80, resilience_score: 81, patience_score: 70,
    self_control_score: 78, rule_adherence_score: 87, risk_discipline_score: 75,
    tilt_score: 90, tilt_events: [], revenge_risk: 0, revenge_count: 0,
    risk_inflation_risk: 10, risk_inflation_count: 1, loss_chase_risk: 0, loss_chase_count: 0,
    fomo_risk: 5, fomo_count: 0, impulse_risk: 0, impulse_count: 0,
    overtrade_risk: 0, overtrade_days: 0, trading_maturity_index: 80, rule_violations: 0,
  }
  const trust = buildBehavioralTrust(r)
  assert.equal(trust.resilience.trust_level, 'High')         // 30 closed, objective
  assert.equal(trust.revenge.confidence, 'Insufficient')     // only 3 losses
  assert.equal(trust.rule_adherence.trust_level, 'Medium')   // self-reported cap
})
