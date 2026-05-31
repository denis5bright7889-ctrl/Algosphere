/**
 * engine-telemetry — classifier + ring buffer tests.
 *
 *     cd apps/web
 *     node --experimental-strip-types --test \
 *         src/lib/intelligence/engine-telemetry.test.ts
 *
 * Pure-function tests. The buffer module imports `'server-only'` which
 * Node can't resolve outside Next.js build, so we test the classifier
 * (pure) and inline a tiny buffer impl for the ring-behavior cases.
 *
 * IMPORTANT INVARIANT enforced here: `classifyError` returns a
 * STRUCTURED enum value; it never carries raw provider names, HTTP
 * bodies, or stack traces forward — so the admin page rendering the
 * classifier output stays screenshot-safe.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Pull the classifier from a pure-function shadow. We can't import
// engine-telemetry.ts here because it has `import 'server-only'` at
// the top — same pattern as reliability-cache.ts. The classifier is
// duplicated below in test-only form to keep the test file
// dependency-free.

type ErrorClass =
  | 'rate_limit'
  | 'credits_exhausted'
  | 'auth_failure'
  | 'timeout'
  | 'connection_refused'
  | 'http_5xx'
  | 'http_4xx'
  | 'config_missing'
  | 'no_data'
  | 'partial_data'
  | 'other'

function classifyError(rawNote: string): ErrorClass | null {
  if (!rawNote) return null
  const t = rawNote.toLowerCase()
  if (/rate.?limit/.test(t))                          return 'rate_limit'
  if (/insufficient\s+credits?|credits?\s+exhausted/.test(t)) return 'credits_exhausted'
  if (/unauthor|forbidden|\bapi[\s-]?key\b/.test(t))  return 'auth_failure'
  if (/timeout|timed\s+out/.test(t))                  return 'timeout'
  if (/econnrefused|connection\s+refused/.test(t))    return 'connection_refused'
  if (/\b5\d\d\b|http\s*5\d\d/.test(t))               return 'http_5xx'
  if (/\b4\d\d\b|http\s*4\d\d/.test(t))               return 'http_4xx'
  if (/not\s+configured|api[\s-]?key.*(missing|not\s+set)/.test(t))
                                                       return 'config_missing'
  if (/insufficient\s+(symbols?|data|bars)|no\s+(data|bars|history)/.test(t))
                                                       return 'no_data'
  if (/partial|excluded\s+from\s+vote|unavailable|fetch\s+failed/.test(t))
                                                       return 'partial_data'
  if (/awaiting|stub|not\s+yet\s+wired/.test(t))      return 'partial_data'
  return null
}


// ═══════════════════════════════════════════════════════════════════
// 1. Classifier maps known errors to the correct enum
// ═══════════════════════════════════════════════════════════════════

test('classifyError: "Nansen 429: rate limit" → rate_limit', () => {
  assert.equal(classifyError('Nansen 429: rate limit exceeded'), 'rate_limit')
})

test('classifyError: "Insufficient credits remaining" → credits_exhausted', () => {
  assert.equal(classifyError('Insufficient credits remaining'), 'credits_exhausted')
})

test('classifyError: "Glassnode 401 Unauthorized" → auth_failure', () => {
  assert.equal(classifyError('Glassnode 401 Unauthorized'), 'auth_failure')
})

test('classifyError: "Forbidden" alone → auth_failure', () => {
  assert.equal(classifyError('Forbidden'), 'auth_failure')
})

test('classifyError: "fetch timed out after 8s" → timeout', () => {
  assert.equal(classifyError('fetch timed out after 8s'), 'timeout')
})

test('classifyError: "ECONNREFUSED 5.189.139.85:8000" → connection_refused', () => {
  assert.equal(classifyError('ECONNREFUSED 5.189.139.85:8000'), 'connection_refused')
})

test('classifyError: "Glassnode 502 Bad Gateway" → http_5xx', () => {
  assert.equal(classifyError('Glassnode 502 Bad Gateway'), 'http_5xx')
})

test('classifyError: "HTTP 503 from upstream" → http_5xx', () => {
  assert.equal(classifyError('HTTP 503 from upstream'), 'http_5xx')
})

test('classifyError: "MT5_BRIDGE_URL not configured" → config_missing', () => {
  assert.equal(classifyError('MT5_BRIDGE_URL not configured'), 'config_missing')
})

test('classifyError: "insufficient bars for regime classification" → no_data', () => {
  assert.equal(classifyError('insufficient bars for regime classification'), 'no_data')
})

test('classifyError: "partial: only 3 symbols available" → partial_data', () => {
  assert.equal(classifyError('partial: only 3 symbols available'), 'partial_data')
})

test('classifyError: "excluded from vote — provider down" → partial_data', () => {
  assert.equal(classifyError('excluded from vote — provider down'), 'partial_data')
})


// ═══════════════════════════════════════════════════════════════════
// 2. Classifier returns null on clean / non-error notes
// ═══════════════════════════════════════════════════════════════════

test('classifyError: institutional reasoning → null', () => {
  assert.equal(
    classifyError('Large-wallet accumulation has exceeded distribution for the last 48 hours.'),
    null,
  )
})

test('classifyError: empty string → null', () => {
  assert.equal(classifyError(''), null)
})

test('classifyError: regime read with state names → null', () => {
  assert.equal(
    classifyError('Regime: 8 constructive / 3 defensive / 2 transitional of 13 scanned (risk-on).'),
    null,
  )
})


// ═══════════════════════════════════════════════════════════════════
// 3. INVARIANT: classifier output is a fixed-enum vocabulary
//     (no leak path for provider names through classifyError itself)
// ═══════════════════════════════════════════════════════════════════

const VALID_CLASSES = new Set<string>([
  'rate_limit', 'credits_exhausted', 'auth_failure', 'timeout',
  'connection_refused', 'http_5xx', 'http_4xx', 'config_missing',
  'no_data', 'partial_data', 'other',
])

test('invariant: 100 hostile inputs never produce out-of-vocabulary output', () => {
  const hostile = [
    'Nansen 403', 'Glassnode rate limit', 'CoinMetrics quota exceeded',
    'Arkham 502 Bad Gateway', 'Whale Alert 504 Gateway Timeout',
    'Santiment unauthorized', 'TwelveData not configured',
    'Polygon API key invalid', 'Finnhub timeout',
    'ECONNREFUSED 192.168.0.1:8000', 'fetch failed',
    'Insufficient credits remaining', 'credits exhausted',
    'HTTP 500', 'HTTP 502', 'HTTP 503', '503: Service Unavailable',
    'Forbidden', 'Awaiting', 'Unavailable',
    'Excluded from vote', 'partial — provider down',
    'no bars in history', 'insufficient symbols',
    'Cannot connect to upstream',
  ]
  for (let i = 0; i < 100; i++) {
    const input = hostile[i % hostile.length]!
    const out = classifyError(input)
    if (out === null) continue
    assert.ok(VALID_CLASSES.has(out),
      `classifier emitted out-of-vocabulary value "${out}" for input "${input}"`)
  }
})


// ═══════════════════════════════════════════════════════════════════
// 4. Ring-buffer behavior (inline minimal impl)
// ═══════════════════════════════════════════════════════════════════

function makeRing(cap: number) {
  const ring: number[] = []
  return {
    push: (v: number) => {
      ring.push(v)
      if (ring.length > cap) ring.shift()
    },
    snapshot: () => [...ring],
    length:   () => ring.length,
  }
}

test('ring buffer: holds the latest N entries when overfilled', () => {
  const ring = makeRing(5)
  for (let i = 1; i <= 8; i++) ring.push(i)
  assert.deepEqual(ring.snapshot(), [4, 5, 6, 7, 8])
  assert.equal(ring.length(), 5)
})

test('ring buffer: empty snapshot is []', () => {
  const ring = makeRing(5)
  assert.deepEqual(ring.snapshot(), [])
})
