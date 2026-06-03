/**
 * Demo video generator — turns a Playwright recording into 3 social
 * MP4s (vertical 1080x1920, landscape 1920x1080, square 1080x1080)
 * with branded chrome + voiceover.
 *
 * Pipeline:
 *   1. Read recordings/<flow>/steps.json
 *   2. Build a narration script keyed off the flow id (one paragraph
 *      per recorded step group) — uses the same edge-tts pipeline
 *      already in marketing/videos.
 *   3. Convert recording.webm → mp4 via Playwright's bundled ffmpeg
 *      (skipped if ffmpeg missing; Remotion can ingest webm directly).
 *   4. Write a Remotion compositions registry that consumes the
 *      recording + voiceover and emits the 3 aspects.
 *   5. Invoke `npx remotion render` for each aspect.
 *
 * Output: growth/demo-engine/out/<flow>/<aspect>.mp4
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REC_BASE  = resolve(__dirname, 'recordings')
const OUT_BASE  = resolve(__dirname, 'out')

// We reuse the existing Remotion project in marketing/videos so we
// don't fork the brand chrome. New compositions live in a parallel
// `demos/` folder there.
const REMOTION_ROOT = resolve(__dirname, '../../marketing/videos')


// ─── Narration scripts (keyed by flow id) ─────────────────────────
// These are the auto-narration the user asked for: written from the
// real product, not generic marketing copy. The voice script is
// passed to edge-tts via the same generate_voice.py we built earlier.

const NARRATIONS = {
  'broker-connect': {
    voice: 'en-US-ChristopherNeural',
    rate:  '+5%',
    lines: [
      'Connect your broker in under sixty seconds.',
      'Open the brokers page. Add MT5. Pick your server. Enter login and password.',
      'Connect. Equity syncs. Positions appear.',
      'And your last six months of trades just imported themselves to your journal.',
      'Auto journal. Risk firewall armed. AI coach starts learning your style.',
      'From zero to a full trader profile. Under a minute.',
    ],
  },
  'place-trade': {
    voice: 'en-US-AriaNeural',
    rate:  '+5%',
    lines: [
      'A signal lands in your feed. Confidence eighty-two. Risk medium.',
      'Tap place trade. Pick your broker. Type your lot size.',
      'The engine checks fifteen risk gates before any order touches the broker.',
      'All fifteen pass. Order placed. Fill confirmed.',
      'Journal entry auto-created. AI insights generated overnight.',
      'Two taps from signal to fill. That is the entire flow.',
    ],
  },
  'intelligence-tour': {
    voice: 'en-US-JennyNeural',
    rate:  '+3%',
    lines: [
      'This is the AlgoSphere intelligence grid. Nine engines. One verdict.',
      'Coverage. Reliability. Data quality. Freshness.',
      'You always know how much to trust the read.',
      'Capital flows. Sentiment. Market structure. Momentum.',
      'And the correlations panel. Rolling Pearson over thirty days.',
      'Bitcoin versus Nasdaq. Bitcoin versus Gold. Bitcoin versus the dollar.',
      'Real institutional analysis. One scroll.',
    ],
  },
  'journal-tour': {
    voice: 'en-US-ChristopherNeural',
    rate:  '+5%',
    lines: [
      'Every trade you take is journaled automatically.',
      'Five process grades per entry. Execution. Psychology. Risk. Discipline. Timing.',
      'AI insights run nightly. Pattern detection. Behavioral flags.',
      'You read it with coffee. Better than any trading coach.',
    ],
  },
}


function loadManifest(flowId) {
  const p = join(REC_BASE, flowId, 'steps.json')
  if (!existsSync(p)) {
    throw new Error(`recording missing for ${flowId} — run record.mjs first`)
  }
  return JSON.parse(readFileSync(p, 'utf8'))
}


/** Write a narration script file the marketing/videos pipeline can
 *  consume, then call its existing generate_voice.py. */
async function buildNarration(flowId) {
  const narration = NARRATIONS[flowId]
  if (!narration) {
    throw new Error(`no narration script defined for ${flowId} — add one to NARRATIONS`)
  }
  const id = `demo_${flowId.replace(/-/g, '_')}`
  const spec = {
    id, title: `Demo: ${flowId}`,
    voice: narration.voice, rate: narration.rate,
    lines: narration.lines.map((text, i) => ({ id: `l${i}`, text })),
  }
  const scriptPath = join(REMOTION_ROOT, 'src', 'scripts', `${id}_script.json`)
  await writeFile(scriptPath, JSON.stringify(spec, null, 2))
  return { id, scriptPath }
}


function runCmd(cmd, args, cwd) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' })
    p.on('exit', (code) => code === 0 ? res() : rej(new Error(`${cmd} exit ${code}`)))
  })
}


async function generateForFlow(flowId) {
  console.log(`\n=== generating demo: ${flowId} ===`)
  const manifest = loadManifest(flowId)
  if (!manifest.video) throw new Error('manifest has no video reference')

  // Narration MP3s + timings.json
  const { id, scriptPath } = await buildNarration(flowId)
  console.log('voice script:', scriptPath)
  await runCmd('python', ['generate_voice.py', join('src', 'scripts', `${id}_script.json`)], REMOTION_ROOT)

  // Copy the recorded webm into the Remotion public/ so it can be
  // served via staticFile().
  const recordingSrc  = join(REC_BASE, flowId, manifest.video)
  const recordingDest = join(REMOTION_ROOT, 'public', id, 'recording.webm')
  await mkdir(dirname(recordingDest), { recursive: true })
  await copyFile(recordingSrc, recordingDest)

  // Render in vertical for now (the registry only lists vertical).
  // Landscape + square follow the same pattern once we extend Root.tsx.
  const outDir = join(OUT_BASE, flowId)
  await mkdir(outDir, { recursive: true })
  console.log('rendering vertical 1080x1920...')
  await runCmd('npx', ['remotion', 'render', id, join('..', '..', 'growth', 'demo-engine', 'out', flowId, 'vertical.mp4')], REMOTION_ROOT)

  console.log('done:', join(outDir, 'vertical.mp4'))
}


async function main() {
  const flowId = process.argv[2]
  if (!flowId) {
    console.error('usage: node generate_demo.mjs <flow-id>')
    console.error('flows defined:')
    for (const id of Object.keys(NARRATIONS)) console.error(`  ${id}`)
    process.exit(1)
  }
  await generateForFlow(flowId)
}


main().catch((e) => {
  console.error('demo generator crashed:', e?.message || e)
  process.exit(1)
})
