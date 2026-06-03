/**
 * Screen recording engine — drives Playwright through a configured
 * RECORDED_FLOWS sequence and saves a .webm per flow. Also produces
 * a per-flow timings.json that maps step → start/end seconds — fed
 * into the demo video generator so narration syncs to the action.
 *
 * Output:
 *   growth/demo-engine/recordings/<flow_id>/recording.webm
 *   growth/demo-engine/recordings/<flow_id>/steps.json
 *
 * Note on tooling: Playwright records video automatically when
 * `recordVideo` is set on the context. The recording starts when
 * the context is created and stops when it closes. Saved frame size
 * comes from the viewport.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_URL, VIEWPORTS, RECORDED_FLOWS } from './config.mjs'
import { authConfigured, loginViaForm, cachedState } from './auth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_BASE = resolve(__dirname, 'recordings')


// Vertical viewport is the default for short-form video output; it
// matches the 1080x1920 Remotion composition without re-cropping.
const RECORD_VIEWPORT = { width: 540, height: 960, deviceScaleFactor: 2 }


async function runStep(page, step) {
  const t0 = Date.now()
  try {
    if (step.action === 'navigate') {
      await page.goto(`${BASE_URL}${step.path}`, { waitUntil: 'networkidle', timeout: 45_000 })
    } else if (step.action === 'wait') {
      await page.waitForTimeout(step.ms || 1000)
    } else if (step.action === 'click') {
      await page.click(step.selector, { timeout: 15_000 })
    } else if (step.action === 'fill') {
      await page.fill(step.selector, step.text ?? '', { timeout: 15_000 })
      // Type-feel: small pause so the recording shows the field updating.
      await page.waitForTimeout(250)
    } else if (step.action === 'hover') {
      await page.hover(step.selector, { timeout: 15_000 })
    } else if (step.action === 'scroll') {
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), step.y || 400)
      await page.waitForTimeout(800)
    } else if (step.action === 'press') {
      await page.keyboard.press(step.key)
    }
    return { ok: true, took_ms: Date.now() - t0, action: step.action }
  } catch (e) {
    return {
      ok: false, took_ms: Date.now() - t0, action: step.action,
      error: String(e?.message || e).slice(0, 200),
    }
  }
}


async function recordFlow(browser, flow, storageStatePath) {
  const outDir = join(OUT_BASE, flow.id)
  await mkdir(outDir, { recursive: true })

  const needsAuth = flow.auth === true
  if (needsAuth && !storageStatePath) {
    console.log(`  SKIP ${flow.id} (requires auth, not configured)`)
    return { id: flow.id, ok: false, reason: 'no-auth' }
  }

  const context = await browser.newContext({
    viewport: RECORD_VIEWPORT,
    deviceScaleFactor: RECORD_VIEWPORT.deviceScaleFactor,
    storageState: storageStatePath ?? undefined,
    recordVideo: {
      dir: outDir,
      size: { width: RECORD_VIEWPORT.width, height: RECORD_VIEWPORT.height },
    },
  })
  const page = await context.newPage()

  const startedAt = Date.now()
  const steps = []
  for (const step of flow.steps) {
    const res = await runStep(page, step)
    steps.push({
      ...res,
      // Cursor-time relative to recording start, so the narration
      // composer can align voice cues with on-screen events.
      relative_s: (Date.now() - startedAt) / 1000,
    })
  }
  const totalSeconds = (Date.now() - startedAt) / 1000

  // Closing the context flushes the WebM. Playwright writes it with
  // a generated filename — we rename to a stable path.
  await page.close()
  await context.close()

  // Locate the produced .webm (Playwright names it nondeterministically)
  // and rename to recording.webm.
  const { readdir } = await import('node:fs/promises')
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.webm'))
  let videoPath = null
  if (files.length > 0) {
    const src = join(outDir, files[0])
    videoPath = join(outDir, 'recording.webm')
    if (existsSync(videoPath)) await writeFile(videoPath, '') // truncate any stale
    await rename(src, videoPath)
  }

  // Write the step manifest so the demo generator can sync narration.
  const manifest = {
    id:        flow.id,
    title:     flow.title,
    total_s:   Number(totalSeconds.toFixed(3)),
    viewport:  RECORD_VIEWPORT,
    steps,
    video:     videoPath ? 'recording.webm' : null,
  }
  await writeFile(join(outDir, 'steps.json'), JSON.stringify(manifest, null, 2))
  return { id: flow.id, ok: true, manifest, videoPath }
}


async function main() {
  console.log(`screen recording engine`)
  console.log(`base url: ${BASE_URL}`)
  console.log(`flows:    ${RECORDED_FLOWS.length}`)

  const browser = await chromium.launch({ headless: true })

  // Get the cached storageState (or log in to create it).
  let state = cachedState()
  if (authConfigured() && !state) {
    console.log('logging in...')
    state = await loginViaForm(browser)
  }

  const results = []
  for (const flow of RECORDED_FLOWS) {
    console.log(`\nrecording: ${flow.id}  (${flow.title})`)
    const res = await recordFlow(browser, flow, state)
    if (res.ok) {
      console.log(`  OK  ${res.manifest.total_s.toFixed(1)}s · ${res.manifest.steps.length} steps -> ${res.videoPath ?? '(no video)'}`)
    } else {
      console.log(`  ERR ${res.reason || 'failed'}`)
    }
    results.push(res)
  }

  await browser.close()

  console.log('\n--- summary ---')
  console.log(`  recorded: ${results.filter((r) => r.ok).length}/${results.length}`)
}


main().catch((e) => {
  console.error('record engine crashed:', e)
  process.exit(1)
})
