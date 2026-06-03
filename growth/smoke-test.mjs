/**
 * Terminal smoke test — fires real test posts to every channel that has
 * env credentials configured. Independent of the admin UI / browser
 * session so you can verify delivery from CI, a server shell, or a
 * laptop with the Vercel env exported locally.
 *
 * Run:
 *   node growth/smoke-test.mjs                       # all configured channels
 *   node growth/smoke-test.mjs --only=discord        # subset
 *   node growth/smoke-test.mjs --only=discord:general,facebook
 *   node growth/smoke-test.mjs --dry                 # no actual POSTs
 *
 * Required env (per channel — channel skipped if env missing):
 *   Discord  → DISCORD_WEBHOOK_<TARGET>_URL
 *   Telegram → TELEGRAM_BOT_TOKEN + GROWTH_TELEGRAM_CHANNEL_ID
 *   Meta FB  → META_PAGE_ACCESS_TOKEN + META_FB_PAGE_ID
 *   Meta IG  → META_PAGE_ACCESS_TOKEN + META_IG_USER_ID
 *   LinkedIn → LINKEDIN_ACCESS_TOKEN + LINKEDIN_AUTHOR_URN
 *
 * Honesty contract: this script never embeds credentials in code or
 * prints them. It reads env, fires HTTP, prints success/failure with
 * external IDs for proof. Failures are logged with the sanitized
 * error from the provider — no API key leakage.
 */
import process from 'node:process'

const argv = process.argv.slice(2)
const DRY   = argv.includes('--dry')
const ONLY  = (argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean)

const STAMP = new Date().toISOString()
const PROBE_TEXT =
  `🧪 AlgoSphereQuant smoke test — ${STAMP}\n` +
  `Fired from the terminal smoke runner.\n` +
  `If you see this, the adapter + credentials are live.\n` +
  `_(Auto-delete this post once you confirm it landed.)_`


// ─── Discord ─────────────────────────────────────────────────────────

const DISCORD_TARGETS = [
  'general', 'announcements', 'market_intel', 'algo_updates', 'education',
  'signals_free', 'signals_premium', 'signals_whales',
  'trades', 'rejections_transparency',
  'health', 'admin', 'support', 'bug_reports',
]

const DISCORD_ENV = (target) =>
  process.env[`DISCORD_WEBHOOK_${target.toUpperCase()}_URL`]

async function postDiscord(target) {
  const url = DISCORD_ENV(target)
  if (!url) return { channel: `discord:${target}`, ok: false, skipped: 'not_configured' }
  if (DRY)  return { channel: `discord:${target}`, ok: true,  skipped: 'dry-run' }
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        username: 'AlgoSphere Smoke',
        embeds: [{
          title:       'Smoke test',
          description: PROBE_TEXT,
          color:       0xfcd34d,
          timestamp:   STAMP,
          footer:      { text: `target=${target}` },
        }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { channel: `discord:${target}`, ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    return { channel: `discord:${target}`, ok: true, external_id: 'webhook-ack' }
  } catch (e) {
    return { channel: `discord:${target}`, ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}


// ─── Telegram ────────────────────────────────────────────────────────

async function postTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat  = process.env.GROWTH_TELEGRAM_CHANNEL_ID
  if (!token || !chat) return { channel: 'telegram', ok: false, skipped: 'not_configured' }
  if (DRY)              return { channel: 'telegram', ok: true,  skipped: 'dry-run' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id: chat, text: PROBE_TEXT, parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) {
      return { channel: 'telegram', ok: false, error: json.description || `HTTP ${res.status}` }
    }
    return { channel: 'telegram', ok: true, external_id: String(json.result?.message_id ?? '') }
  } catch (e) {
    return { channel: 'telegram', ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}


// ─── Facebook ────────────────────────────────────────────────────────

async function postFacebook() {
  const token = process.env.META_PAGE_ACCESS_TOKEN
  const page  = process.env.META_FB_PAGE_ID
  if (!token || !page) return { channel: 'facebook', ok: false, skipped: 'not_configured' }
  if (DRY)              return { channel: 'facebook', ok: true,  skipped: 'dry-run' }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${page}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: PROBE_TEXT, access_token: token }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) {
      return { channel: 'facebook', ok: false, error: json.error?.message || `HTTP ${res.status}` }
    }
    const postId = String(json.id ?? '')
    return {
      channel: 'facebook',
      ok: true,
      external_id: postId,
      external_url: postId.includes('_') ? `https://facebook.com/${postId.split('_')[1]}` : undefined,
    }
  } catch (e) {
    return { channel: 'facebook', ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}


// ─── Instagram (image feed — needs a hero) ──────────────────────────

async function postInstagram() {
  const token = process.env.META_PAGE_ACCESS_TOKEN
  const igId  = process.env.META_IG_USER_ID
  if (!token || !igId) return { channel: 'instagram', ok: false, skipped: 'not_configured' }
  if (DRY)              return { channel: 'instagram', ok: true,  skipped: 'dry-run' }
  // IG needs a hosted image at IG specs (max 1080 wide). The OG image
  // is 1254 wide which fails silently with the "Only photo or video"
  // error. We use a dedicated 1080×1080 hero committed under
  // apps/web/public/growth/ for this exact probe.
  const hero = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/growth/smoke-test-hero.jpg`
    : 'https://algospherequant.com/growth/smoke-test-hero.jpg'
  try {
    // 1) Create container
    // Graph API v17+ requires media_type for the disambiguation —
    // omitting it returns "Only photo or video can be accepted as
    // media type" even when image_url is a valid PNG. See
    // apps/web/src/lib/growth/adapters/meta.ts for the same fix.
    const create = await fetch(`https://graph.facebook.com/v20.0/${igId}/media`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        media_type: 'IMAGE',
        image_url:  hero,
        caption:    PROBE_TEXT,
        access_token: token,
      }),
    })
    const cJson = await create.json().catch(() => ({}))
    if (!create.ok || cJson.error || !cJson.id) {
      return { channel: 'instagram', ok: false, error: cJson.error?.message || `container HTTP ${create.status}` }
    }
    // 2) Publish container
    const pub = await fetch(`https://graph.facebook.com/v20.0/${igId}/media_publish`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ creation_id: cJson.id, access_token: token }),
    })
    const pJson = await pub.json().catch(() => ({}))
    if (!pub.ok || pJson.error || !pJson.id) {
      return { channel: 'instagram', ok: false, error: pJson.error?.message || `publish HTTP ${pub.status}` }
    }
    return { channel: 'instagram', ok: true, external_id: String(pJson.id) }
  } catch (e) {
    return { channel: 'instagram', ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}


// ─── LinkedIn (UGC posts) ────────────────────────────────────────────

async function postLinkedIn() {
  const token  = process.env.LINKEDIN_ACCESS_TOKEN
  const author = process.env.LINKEDIN_AUTHOR_URN  // e.g. urn:li:organization:12345
  if (!token || !author) return { channel: 'linkedin', ok: false, skipped: 'not_configured' }
  if (DRY)                return { channel: 'linkedin', ok: true,  skipped: 'dry-run' }
  try {
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method:  'POST',
      headers: {
        'Authorization':            `Bearer ${token}`,
        'Content-Type':             'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author, lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary:    { text: PROBE_TEXT },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { channel: 'linkedin', ok: false, error: json.message || `HTTP ${res.status}` }
    }
    return { channel: 'linkedin', ok: true, external_id: String(json.id ?? '') }
  } catch (e) {
    return { channel: 'linkedin', ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}


// ─── Driver ──────────────────────────────────────────────────────────

function wantChannel(name) {
  if (ONLY.length === 0) return true
  return ONLY.some((sel) => name === sel || name.startsWith(sel + ':') || sel === name.split(':')[0])
}

async function main() {
  const results = []
  for (const t of DISCORD_TARGETS) if (wantChannel(`discord:${t}`)) results.push(await postDiscord(t))
  if (wantChannel('telegram'))  results.push(await postTelegram())
  if (wantChannel('facebook'))  results.push(await postFacebook())
  if (wantChannel('instagram')) results.push(await postInstagram())
  if (wantChannel('linkedin'))  results.push(await postLinkedIn())

  const summary = {
    fired_at:  STAMP,
    dry:       DRY,
    total:     results.length,
    delivered: results.filter((r) => r.ok && !r.skipped).length,
    failed:    results.filter((r) => !r.ok && !r.skipped).length,
    not_configured: results.filter((r) => r.skipped === 'not_configured').length,
  }

  console.log('\n=== AlgoSphereQuant smoke test ===')
  console.log(`fired_at: ${STAMP}${DRY ? '  (DRY RUN)' : ''}\n`)
  for (const r of results) {
    const mark =
      r.skipped === 'not_configured' ? '○ skip' :
      r.skipped === 'dry-run'        ? '○ dry'  :
      r.ok                            ? '✓ ok'   :
                                        '✗ fail'
    const tail = r.external_id ? ` (id=${r.external_id})` :
                 r.error       ? ` (${r.error})` :
                 r.skipped     ? ` (${r.skipped})` : ''
    console.log(`  ${mark.padEnd(7)} ${r.channel.padEnd(28)}${tail}`)
  }
  console.log('\nsummary:', JSON.stringify(summary, null, 0))

  // Exit non-zero if anything that was attempted (not skipped) failed —
  // so CI can fail the job and operator gets a real signal.
  process.exit(summary.failed > 0 ? 1 : 0)
}


main().catch((e) => {
  console.error('smoke runner crashed:', e)
  process.exit(2)
})
