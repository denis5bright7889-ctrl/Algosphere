/**
 * Meta Graph API adapter — covers Facebook, Instagram (feed), and
 * Instagram Reels in a single module since they share the Graph API.
 *
 * Env required:
 *   META_PAGE_ACCESS_TOKEN  — long-lived Page access token for the
 *                              Facebook page tied to the IG business.
 *   META_FB_PAGE_ID         — Facebook Page id (numeric)
 *   META_IG_USER_ID         — IG Business Account id (numeric, from
 *                              /me/accounts → instagram_business_account)
 *
 * Cold start:
 *   1. Convert your Instagram account → Business / Creator.
 *   2. Link it to a Facebook Page (one-time).
 *   3. Create a Meta app at https://developers.facebook.com/apps
 *      (Business type), add the Pages + Instagram permissions.
 *   4. Use Graph API Explorer to mint a long-lived Page token
 *      (60-day) — store as META_PAGE_ACCESS_TOKEN.
 *   5. Find the IG user id with:
 *        GET /me/accounts?fields=instagram_business_account
 *
 * Instagram feed posts require a hero image — set hero_image_url
 * on the content_item or the adapter will refuse.
 *
 * IG Reels needs a video_url + cover_url — caller must supply.
 */
import type { AdapterResult } from './telegram'

const TOKEN = () => process.env.META_PAGE_ACCESS_TOKEN
const FB_PAGE_ID = () => process.env.META_FB_PAGE_ID
const IG_USER_ID = () => process.env.META_IG_USER_ID

export async function postToFacebook(text: string): Promise<AdapterResult> {
  const t = TOKEN(); const p = FB_PAGE_ID()
  if (!t || !p) return { ok: false, error: 'Facebook adapter not configured — set META_PAGE_ACCESS_TOKEN + META_FB_PAGE_ID in Vercel env.' }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${p}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, access_token: t }),
    })
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!res.ok || json.error) return { ok: false, error: json.error?.message ?? `Facebook API HTTP ${res.status}` }
    return { ok: true, external_id: json.id, response: { post_id: json.id ?? null } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function postToInstagram(text: string, imageUrl?: string): Promise<AdapterResult> {
  const t = TOKEN(); const u = IG_USER_ID()
  if (!t || !u) return { ok: false, error: 'Instagram adapter not configured — set META_PAGE_ACCESS_TOKEN + META_IG_USER_ID in Vercel env.' }
  if (!imageUrl) return { ok: false, error: 'Instagram feed posts require a hero_image_url on the content_item.' }

  try {
    // Two-step: create media container, then publish.
    //
    // Graph API v17+ rejects image containers without an explicit
    // media_type — the error reads "Only photo or video can be
    // accepted as media type" even though we are sending an image_url.
    // Setting media_type='IMAGE' tells IG to parse the URL as a photo
    // and is the documented way to disambiguate single-image posts
    // from carousels or stories. Older versions accepted the omission
    // by inference but post-2024 versions reject it.
    const create = await fetch(`https://graph.facebook.com/v20.0/${u}/media`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        media_type: 'IMAGE',
        image_url:  imageUrl,
        caption:    text,
        access_token: t,
      }),
    })
    const created = (await create.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!create.ok || !created.id) return { ok: false, error: created.error?.message ?? `IG container HTTP ${create.status}` }

    const publish = await fetch(`https://graph.facebook.com/v20.0/${u}/media_publish`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ creation_id: created.id, access_token: t }),
    })
    const pub = (await publish.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!publish.ok || !pub.id) return { ok: false, error: pub.error?.message ?? `IG publish HTTP ${publish.status}` }

    return { ok: true, external_id: pub.id, response: { media_id: pub.id } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function postToInstagramReels(_text: string, _videoUrl?: string): Promise<AdapterResult> {
  return { ok: false, error: 'IG Reels adapter not implemented — requires a hosted video URL + a multi-step Graph API container flow. Set up via /reels endpoint when ready.' }
}
