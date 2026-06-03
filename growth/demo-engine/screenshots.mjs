/**
 * Screenshot engine — captures every configured route in 3 viewports
 * (desktop / tablet / mobile) and writes PNGs under
 * apps/web/public/growth/screenshots/<viewport>/<route_id>.png.
 *
 * That path is intentional: serving from the web app's public/ makes
 * the captures available at /growth/screenshots/* on the live site
 * (useful for landing pages, blog embeds, and the future Founder
 * Studio attribution panel).
 *
 * Strategy:
 *   1. If auth is configured, log in once and reuse storageState.
 *   2. For each viewport, open a single context (cookies shared).
 *   3. For each route, navigate, wait for load state, screenshot.
 *   4. Failures are logged and skipped — never abort the whole run.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_URL, VIEWPORTS, PUBLIC_ROUTES, PROTECTED_ROUTES } from './config.mjs'
import { authConfigured, loginViaForm, cachedState } from './auth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Write under the web app's public/ so screenshots are URL-addressable
// on the live site. The growth/demo-engine workspace stays clean.
const OUT_BASE = resolve(__dirname, '../../apps/web/public/growth/screenshots')


async function captureRoute(page, route, outDir) {
  const url = `${BASE_URL}${route.path}`
  const file = join(outDir, `${route.id}.png`)
  try {
    await page.goto(url, {
      waitUntil: route.waitFor === 'networkidle' ? 'networkidle' : 'load',
      timeout: 45_000,
    })
    // Give async hydration + grid composers time to render.
    await page.waitForTimeout(800)
    await page.screenshot({ path: file, fullPage: true })
    return { ok: true, route: route.id, file }
  } catch (e) {
    return { ok: false, route: route.id, error: String(e?.message || e).slice(0, 200) }
  }
}


async function captureViewport(browser, name, viewport, storageStatePath) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.deviceScaleFactor,
    // Reuse logged-in state when present so protected routes work.
    storageState: storageStatePath ?? undefined,
  })
  const page = await context.newPage()

  const outDir = join(OUT_BASE, name)
  await mkdir(outDir, { recursive: true })

  const routes = storageStatePath
    ? [...PUBLIC_ROUTES, ...PROTECTED_ROUTES]
    : PUBLIC_ROUTES

  console.log(`\n[${name}] ${viewport.width}x${viewport.height} · ${routes.length} routes`)
  const results = []
  for (const r of routes) {
    const res = await captureRoute(page, r, outDir)
    if (res.ok) console.log(`  OK  ${r.id.padEnd(20)} -> ${res.file}`)
    else        console.log(`  ERR ${r.id.padEnd(20)} ${res.error}`)
    results.push(res)
  }

  await page.close()
  await context.close()
  return results
}


async function main() {
  console.log(`screenshot engine`)
  console.log(`base url: ${BASE_URL}`)
  console.log(`auth:     ${authConfigured() ? AUTH_summary() : 'NOT CONFIGURED — public routes only'}`)

  const browser = await chromium.launch({ headless: true })

  // Acquire a logged-in storage state once (if credentials are set
  // and we don't already have one cached).
  let state = cachedState()
  if (authConfigured() && !state) {
    console.log('logging in (first run)...')
    state = await loginViaForm(browser)
    console.log(state ? `  state -> ${state}` : `  login FAILED — running public-only`)
  }

  // One context per viewport. Cookies + storage carry across routes
  // inside a viewport but not across viewports (intentional — DOM
  // resize between viewport switches is unreliable in headless).
  const summary = {}
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    summary[name] = await captureViewport(browser, name, vp, state)
  }

  await browser.close()

  // Compact summary at the end so the operator can spot failures.
  console.log('\n--- summary ---')
  for (const [name, results] of Object.entries(summary)) {
    const ok = results.filter((r) => r.ok).length
    const fail = results.length - ok
    console.log(`  ${name.padEnd(8)} ok=${ok}  fail=${fail}`)
  }
}


function AUTH_summary() {
  return `configured (${process.env.DEMO_AUTH_EMAIL?.slice(0, 3)}…)`
}


main().catch((e) => {
  console.error('screenshot engine crashed:', e)
  process.exit(1)
})
