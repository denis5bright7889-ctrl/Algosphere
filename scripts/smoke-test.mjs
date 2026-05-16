#!/usr/bin/env node
/**
 * AlgoSphere Quant — Production smoke test.
 *
 * Hits a curated set of critical-path endpoints against a deployed URL,
 * reports pass/fail per check, and exits non-zero on any hard failure.
 *
 * Usage:
 *   node scripts/smoke-test.mjs https://algosphere.vercel.app
 *   BASE_URL=https://... node scripts/smoke-test.mjs
 */

const BASE = process.argv[2] || process.env.BASE_URL
if (!BASE) {
  console.error('usage: smoke-test.mjs <base-url>')
  process.exit(2)
}

const checks = [
  // Public marketing
  { name: 'landing',     path: '/',                  expect: [200] },
  { name: 'leaderboard', path: '/traders',           expect: [200] },
  { name: 'enterprise',  path: '/enterprise',        expect: [200] },

  // Auth-gated (should redirect to /login, not 500)
  { name: 'overview-gate',   path: '/overview',   expect: [200, 307, 302] },
  { name: 'signals-gate',    path: '/signals',    expect: [200, 307, 302] },
  { name: 'journal-gate',    path: '/journal',    expect: [200, 307, 302] },
  { name: 'execution-gate',  path: '/execution',  expect: [200, 307, 302] },

  // Public API GETs (should respond — 401/200 both fine; 5xx fail)
  { name: 'api-vapid',      path: '/api/alerts/push/vapid',   expect: [200, 503] },
  { name: 'api-calendar',   path: '/api/market/calendar',     expect: [200] },
  { name: 'api-news',       path: '/api/market/news',         expect: [200] },
  { name: 'api-leaderboard',path: '/api/social/follow',       expect: [401, 400] }, // GET on follow → 400

  // Manifest + service worker reachable
  { name: 'pwa-manifest',   path: '/manifest.webmanifest',    expect: [200] },
  { name: 'service-worker', path: '/sw.js',                   expect: [200] },
]

let failed = 0
let slow = 0
const SLOW_MS = 3000
const TIMEOUT_MS = 10_000

async function probe(c) {
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    const res = await fetch(`${BASE}${c.path}`, {
      method: 'GET',
      redirect: 'manual',
      signal: ctl.signal,
      headers: { 'User-Agent': 'algosphere-smoke/1.0' },
    })
    clearTimeout(timer)
    const ms = Date.now() - t0
    const ok = c.expect.includes(res.status)
    if (ms > SLOW_MS) slow++
    return {
      name:   c.name,
      path:   c.path,
      status: res.status,
      ms,
      ok,
      slow:   ms > SLOW_MS,
    }
  } catch (err) {
    return {
      name: c.name, path: c.path, status: 0,
      ms: Date.now() - t0, ok: false,
      err: String(err).slice(0, 80),
    }
  }
}

console.log(`\nSmoke test → ${BASE}\n${'─'.repeat(60)}`)

const results = await Promise.all(checks.map(probe))

for (const r of results) {
  const mark = r.ok ? '✓' : '✗'
  const dur  = r.slow ? `${r.ms}ms ⚠ SLOW` : `${r.ms}ms`
  const stat = r.status === 0 ? 'ERR' : String(r.status)
  console.log(`  ${mark} ${r.name.padEnd(18)} ${r.path.padEnd(34)} ${stat.padStart(3)}  ${dur}${r.err ? `  ${r.err}` : ''}`)
  if (!r.ok) failed++
}

console.log('─'.repeat(60))
console.log(`  ${results.length - failed}/${results.length} passed · ${slow} slow (>${SLOW_MS}ms)`)

if (failed > 0) {
  console.error(`\n✗ ${failed} check(s) failed\n`)
  process.exit(1)
}
console.log(`\n✓ all green\n`)
