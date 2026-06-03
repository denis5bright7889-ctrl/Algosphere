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

/**
 * Resolve a Page Access Token from the System User access token.
 *
 * Meta's documented pattern: POST /{page-id}/feed with a System User
 * token often returns "requires both pages_read_engagement and
 * pages_manage_posts as an admin with sufficient administrative
 * permission" — even when the SU has Full Control on the Page and
 * the token has all the required scopes. The graph API expects a
 * Page-scoped token for posting AS the Page.
 *
 * GET /{page-id}?fields=access_token with the SU token returns a
 * Page Access Token that satisfies the "admin" check. Cached in
 * memory for the duration of the function instance — Page tokens
 * derived from a System User token never expire.
 */
let _pageTokenCache: { pageId: string; token: string } | null = null

async function getPageAccessToken(suToken: string, pageId: string): Promise<string | null> {
  if (_pageTokenCache && _pageTokenCache.pageId === pageId) return _pageTokenCache.token
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(suToken)}`,
      { cache: 'no-store' },
    )
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } }
    if (!res.ok || !json.access_token) return null
    _pageTokenCache = { pageId, token: json.access_token }
    return json.access_token
  } catch {
    return null
  }
}


export async function postToFacebook(text: string): Promise<AdapterResult> {
  const t = TOKEN(); const p = FB_PAGE_ID()
  if (!t || !p) return { ok: false, error: 'Facebook adapter not configured — set META_PAGE_ACCESS_TOKEN + META_FB_PAGE_ID in Vercel env.' }

  // Derive the Page Access Token from the System User token. This is
  // the Meta-documented pattern for posting AS the Page — see the
  // getPageAccessToken() comment for the gory details. Falls back
  // to using the SU token directly if the derivation fails (we still
  // log the failure so the operator can debug).
  const pageToken = await getPageAccessToken(t, p)
  const tokenForPost = pageToken ?? t

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${p}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, access_token: tokenForPost }),
    })
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!res.ok || json.error) return {
      ok: false,
      error: json.error?.message ?? `Facebook API HTTP ${res.status}`,
      response: { used_page_token: pageToken !== null },
    }
    return { ok: true, external_id: json.id, response: { post_id: json.id ?? null, used_page_token: pageToken !== null } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function postToInstagram(text: string, imageUrl?: string): Promise<AdapterResult> {
  const t = TOKEN(); const u = IG_USER_ID(); const p = FB_PAGE_ID()
  if (!t || !u) return { ok: false, error: 'Instagram adapter not configured — set META_PAGE_ACCESS_TOKEN + META_IG_USER_ID in Vercel env.' }
  if (!imageUrl) return { ok: false, error: 'Instagram feed posts require a hero_image_url on the content_item.' }

  // IG containers are owned by the linked FB Page — Meta's API expects
  // the Page Access Token, not the System User token. Same derivation
  // as postToFacebook; falls back to SU token when the FB page id is
  // missing.
  const pageToken = p ? await getPageAccessToken(t, p) : null
  const tokenForCall = pageToken ?? t

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
        access_token: tokenForCall,
      }),
    })
    const created = (await create.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!create.ok || !created.id) return { ok: false, error: created.error?.message ?? `IG container HTTP ${create.status}` }

    const publish = await fetch(`https://graph.facebook.com/v20.0/${u}/media_publish`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Publish uses the same Page-scoped token as the container create.
      body:    JSON.stringify({ creation_id: created.id, access_token: tokenForCall }),
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
