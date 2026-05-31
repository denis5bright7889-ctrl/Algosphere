/**
 * Reliability layer — sanitization + freshness + cache tests.
 *
 * Pure-function suite. Runs with Node's built-in test runner:
 *
 *     cd apps/web
 *     node --experimental-strip-types --test \
 *         src/lib/intelligence/reliability.test.ts
 *
 * Each case enforces a founder rule from the Market Intelligence
 * Reliability Upgrade directive — if any of these fail, the user is
 * about to see something they shouldn't.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isCleanReasoning, sanitizeReasoning,
  deriveSourceQuality, deriveUserStatus,
  freshnessLabel, ttlFor,
} from './reliability.ts'
// reliability-cache.ts is server-only (depends on 'server-only' which
// only resolves at Next.js build time) — its surface is a 30-line Map
// round-trip and is covered by the integration smoke check in grid.ts.


// ═══════════════════════════════════════════════════════════════════
// 1. Provider names + error codes can NEVER appear in user reasoning
// ═══════════════════════════════════════════════════════════════════

test('sanitize: "Nansen 403: Insufficient credits" is replaced', () => {
  const result = sanitizeReasoning('smartMoney', 'Nansen 403: Insufficient credits remaining')
  assert.doesNotMatch(result, /nansen/i, `Nansen leaked: "${result}"`)
  assert.doesNotMatch(result, /403/,     `403 leaked: "${result}"`)
  assert.doesNotMatch(result, /credit/i, `Credits leaked: "${result}"`)
  // It should fall back to the engine's canonical reasoning.
  assert.match(result, /large-wallet|recalibrating|sources/i)
})

test('sanitize: "Glassnode rate limit exceeded" is replaced', () => {
  const result = sanitizeReasoning('whaleFlow', 'Glassnode rate limit exceeded')
  assert.doesNotMatch(result, /glassnode|rate.?limit/i, `Leaked: "${result}"`)
})

test('sanitize: "HTTP 502 from coinmetrics" is replaced', () => {
  const result = sanitizeReasoning('smartMoney', 'HTTP 502 from coinmetrics')
  assert.doesNotMatch(result, /http\s*502|coinmetrics/i)
})

test('sanitize: "fetch failed: ECONNREFUSED" is replaced', () => {
  const result = sanitizeReasoning('correlation', 'fetch failed: ECONNREFUSED 5.189.139.85:8000')
  assert.doesNotMatch(result, /fetch failed|econnrefused|\d+\.\d+\.\d+\.\d+/i)
})

test('sanitize: empty string falls back to engine canonical', () => {
  const result = sanitizeReasoning('regime', '')
  assert.ok(result.length > 10, 'fallback reasoning should be non-empty')
  assert.match(result, /regime|trend|warming/i)
})

test('sanitize: "Awaiting" is treated as error (user must NEVER see this)', () => {
  const result = sanitizeReasoning('smartMoney', 'Awaiting')
  assert.doesNotMatch(result, /awaiting/i, `"Awaiting" leaked: "${result}"`)
})

test('sanitize: "excluded from vote" is treated as error', () => {
  const result = sanitizeReasoning('momentum', 'Excluded from vote — provider down')
  assert.doesNotMatch(result, /excluded from vote/i)
})

test('isCleanReasoning: legitimate institutional reasoning passes through', () => {
  assert.equal(
    isCleanReasoning('Large-wallet accumulation has exceeded distribution for the last 48 hours.'),
    true,
  )
  assert.equal(
    isCleanReasoning('Defensive assets dominate breadth; risk participation remains below threshold.'),
    true,
  )
})

test('isCleanReasoning: messages with provider names fail', () => {
  assert.equal(isCleanReasoning('Sourced from Nansen primary'), false)
  assert.equal(isCleanReasoning('Whale Alert reports no anomalies'), false)
})


// ═══════════════════════════════════════════════════════════════════
// 2. Source quality derivation
// ═══════════════════════════════════════════════════════════════════

test('source_quality: live high-strength → high', () => {
  const sq = deriveSourceQuality({
    available: true, strength01: 0.85, ageMs: 0, ttlMs: 30 * 60_000,
  })
  assert.equal(sq, 'high')
})

test('source_quality: live medium-strength → medium', () => {
  const sq = deriveSourceQuality({
    available: true, strength01: 0.5, ageMs: 0, ttlMs: 30 * 60_000,
  })
  assert.equal(sq, 'medium')
})

test('source_quality: ageing past half-TTL → low', () => {
  const sq = deriveSourceQuality({
    available: true, strength01: 0.9,
    ageMs: 20 * 60_000, ttlMs: 30 * 60_000,
  })
  assert.equal(sq, 'low')
})

test('source_quality: unavailable → fallback', () => {
  const sq = deriveSourceQuality({
    available: false, strength01: 0, ageMs: 0, ttlMs: 30 * 60_000,
  })
  assert.equal(sq, 'fallback')
})


// ═══════════════════════════════════════════════════════════════════
// 3. User status taxonomy
// ═══════════════════════════════════════════════════════════════════

test('userStatus: live data → "live"', () => {
  assert.equal(
    deriveUserStatus({ available: true, fromCache: false, ageMs: 0, ttlMs: 30 * 60_000 }),
    'live',
  )
})

test('userStatus: from cache, within TTL → "stale" (NOT "awaiting")', () => {
  const u = deriveUserStatus({
    available: false, fromCache: true,
    ageMs: 10 * 60_000, ttlMs: 30 * 60_000,
  })
  assert.equal(u, 'stale')
})

test('userStatus: no cache + unavailable → "building" (NOT "awaiting")', () => {
  assert.equal(
    deriveUserStatus({ available: false, fromCache: false, ageMs: 0, ttlMs: 30 * 60_000 }),
    'building',
  )
})


// ═══════════════════════════════════════════════════════════════════
// 4. Freshness label
// ═══════════════════════════════════════════════════════════════════

test('freshnessLabel: 5 seconds → "just now"', () => {
  const t = new Date(Date.now() - 5_000).toISOString()
  assert.equal(freshnessLabel(t), 'just now')
})

test('freshnessLabel: 90 seconds → "Nm ago"', () => {
  const t = new Date(Date.now() - 90_000).toISOString()
  assert.match(freshnessLabel(t), /\dm ago/)
})

test('freshnessLabel: 3 hours → "Nh ago"', () => {
  const t = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
  assert.match(freshnessLabel(t), /\dh ago/)
})


// ═══════════════════════════════════════════════════════════════════
// 5. TTL config matches the founder spec
// ═══════════════════════════════════════════════════════════════════

test('TTL for known engines matches the founder spec', () => {
  assert.equal(ttlFor('regime'),      15 * 60_000)
  assert.equal(ttlFor('smartMoney'),  30 * 60_000)
  assert.equal(ttlFor('whaleFlow'),   30 * 60_000)
  assert.equal(ttlFor('correlation'), 60 * 60_000)
  assert.equal(ttlFor('breadth'),     15 * 60_000)
})


// ═══════════════════════════════════════════════════════════════════
// 6. Invariant: every sanitized output is free of forbidden tokens
// ═══════════════════════════════════════════════════════════════════

test('invariant: 50 hostile inputs never leak forbidden tokens', () => {
  const hostile = [
    'Nansen 403',
    'Nansen 429: rate limit',
    'Glassnode 502 Bad Gateway',
    'Arkham unauthorized',
    'CoinMetrics quota exceeded',
    'Whale Alert API key missing',
    'Santiment forbidden',
    'fetch failed',
    'failed to fetch',
    'ECONNREFUSED',
    'Awaiting',
    'Unavailable',
    'Excluded from vote',
    'Insufficient credits remaining',
    'credits exhausted',
    'HTTP 500',
    'HTTP 502',
    'HTTP 503',
    '503: Service Unavailable',
    'TwelveData not configured',
    'finnhub timeout',
    'polygon api key invalid',
    'Cannot connect to upstream',
  ]
  const engines = ['regime', 'momentum', 'breadth', 'smartMoney', 'whaleFlow',
                   'dominance', 'correlation', 'volatility', 'execution']
  for (let i = 0; i < 50; i++) {
    const engine = engines[i % engines.length]!
    const input  = hostile[i % hostile.length]!
    const out = sanitizeReasoning(engine, input)
    assert.doesNotMatch(out, /nansen|glassnode|arkham|coinmetrics|whale alert|santiment|twelvedata|finnhub|polygon/i,
      `provider leaked for "${input}" → "${out}"`)
    assert.doesNotMatch(out, /\bhttp\s*\d{3}\b|\b\d{3}:\s*|insufficient|credits?|rate.?limit|fetch failed|econnrefused|unauthorized|forbidden/i,
      `error wording leaked for "${input}" → "${out}"`)
    assert.doesNotMatch(out, /awaiting|unavailable|excluded from vote/i,
      `forbidden user-facing label leaked for "${input}" → "${out}"`)
  }
})
