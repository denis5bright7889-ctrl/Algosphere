/**
 * Psychology leaderboard — pure assembly tests.
 *
 *     cd apps/web
 *     node --experimental-strip-types --test \
 *         src/lib/intelligence/psychology-leaderboard.test.ts
 *
 * Coverage: range→window mapping, eligibility gate, anonymized-handle
 * determinism + no-PII, and assembly (ranking, thin-sample exclusion,
 * is_you tagging, percentile bounds, no id/PII leakage in rows).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rangeToWindowDays, isLeaderboardRange, isEligible, anonymizeHandle,
  assembleLeaderboard, type EligibleProfile, type UserEntries,
} from './psychology-leaderboard.ts'
import type { V3Entry } from './psychology-v3.ts'

function fill(n: number, startISO: string, pnlBias = 0): V3Entry[] {
  const start = +new Date(startISO)
  return Array.from({ length: n }, (_, i) => ({
    created_at: new Date(start + i * 28 * 3_600_000).toISOString(),
    pnl: (i % 2 === 0 ? 12 : -8) + pnlBias,
    risk_pct: 1, lot_size: 1, pair: 'EURUSD',
    setup_tag: 'breakout', emotion_pre: 'calm', rule_violation: false,
  }))
}

// ── range / eligibility ─────────────────────────────────────────────

test('rangeToWindowDays maps each range', () => {
  assert.equal(rangeToWindowDays('weekly'), 7)
  assert.equal(rangeToWindowDays('monthly'), 30)
  assert.equal(rangeToWindowDays('global'), 365)
})

test('isLeaderboardRange guards bad input', () => {
  assert.ok(isLeaderboardRange('global'))
  assert.ok(!isLeaderboardRange('yearly'))
  assert.ok(!isLeaderboardRange(undefined))
})

test('isEligible requires opt-in AND both consents', () => {
  const base: EligibleProfile = {
    id: 'u', public_handle: null, leaderboard_opt_in: true,
    terms_accepted_at: '2026-01-01T00:00:00Z', privacy_accepted_at: '2026-01-01T00:00:00Z',
  }
  assert.ok(isEligible(base))
  assert.ok(!isEligible({ ...base, leaderboard_opt_in: false }))
  assert.ok(!isEligible({ ...base, leaderboard_opt_in: null }))
  assert.ok(!isEligible({ ...base, terms_accepted_at: null }))
  assert.ok(!isEligible({ ...base, privacy_accepted_at: null }))
})

// ── anonymization ───────────────────────────────────────────────────

test('anonymizeHandle is deterministic and leaks no PII', () => {
  const a = anonymizeHandle('user-uuid-1234')
  assert.equal(a, anonymizeHandle('user-uuid-1234'))
  assert.match(a, /^Trader-[0-9A-Z]{4}$/)
  assert.ok(!a.includes('user-uuid-1234'))
  assert.notEqual(anonymizeHandle('a'), anonymizeHandle('b'))
})

// ── assembly ────────────────────────────────────────────────────────

test('assembleLeaderboard ranks, tags is_you, and excludes thin samples', () => {
  const users: UserEntries[] = [
    { userId: 'a', handle: 'alpha',  entries: fill(24, '2026-04-01T08:00:00Z', 6) },  // strong
    { userId: 'b', handle: null,     entries: fill(24, '2026-04-01T08:00:00Z', 0) },  // mid, no handle
    { userId: 'c', handle: 'gamma',  entries: fill(3,  '2026-04-01T08:00:00Z', 0) },  // thin → excluded
  ]
  const { rows, you } = assembleLeaderboard(users, 30, 'b')

  // Thin-sample user dropped.
  assert.ok(rows.length >= 2 && rows.length <= 2 + 0)
  assert.ok(!rows.some((r) => r.display_name === 'gamma'))

  // Ranks are 1..N, ascending, percentile within bounds.
  assert.equal(rows[0]!.rank, 1)
  for (const r of rows) {
    assert.ok(r.percentile >= 0 && r.percentile <= 100)
    assert.ok(r.maturity_score >= 0 && r.maturity_score <= 100)
    // Leak guard: row shape carries no id / email / entries.
    assert.deepEqual(
      Object.keys(r).sort(),
      ['consistency_score', 'discipline_score', 'display_name', 'is_you', 'maturity_score', 'patience_score', 'percentile', 'rank'],
    )
  }

  // is_you tagging + anonymized fallback for the handle-less user.
  const me = rows.find((r) => r.is_you)
  assert.ok(me)
  assert.equal(me, you)
  assert.match(me!.display_name, /^Trader-[0-9A-Z]{4}$/)
})

test('assembleLeaderboard returns no you-row when current user absent', () => {
  const users: UserEntries[] = [
    { userId: 'a', handle: 'alpha', entries: fill(20, '2026-04-01T08:00:00Z') },
  ]
  const { you } = assembleLeaderboard(users, 30, 'someone-else')
  assert.equal(you, null)
})

test('assembleLeaderboard handles an empty participant set', () => {
  const { rows, you } = assembleLeaderboard([], 365, 'a')
  assert.deepEqual(rows, [])
  assert.equal(you, null)
})
