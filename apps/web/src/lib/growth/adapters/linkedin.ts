/**
 * LinkedIn channel adapter.
 *
 * Env required (OAuth 2.0):
 *   LINKEDIN_ACCESS_TOKEN  — User access token from the LinkedIn
 *                            "Sign In with LinkedIn" + "Share on
 *                            LinkedIn" product approval flow.
 *   LINKEDIN_AUTHOR_URN    — "urn:li:person:<id>" or
 *                            "urn:li:organization:<id>" (the page).
 *
 * Cold start: create a LinkedIn Developer App at
 *   https://www.linkedin.com/developers/apps
 * with the Share on LinkedIn + Sign In with LinkedIn products, then
 * run the OAuth flow once to mint LINKEDIN_ACCESS_TOKEN (60-day
 * lifetime; rotate before expiry — automation lives in Phase 4).
 */
import type { AdapterResult } from './telegram'

export async function postToLinkedIn(text: string): Promise<AdapterResult> {
  const token  = process.env.LINKEDIN_ACCESS_TOKEN
  const author = process.env.LINKEDIN_AUTHOR_URN
  if (!token || !author) {
    return { ok: false, error: 'LinkedIn adapter not configured — set LINKEDIN_ACCESS_TOKEN + LINKEDIN_AUTHOR_URN in Vercel env.' }
  }

  try {
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method:  'POST',
      headers: {
        'Authorization':            `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type':             'application/json',
      },
      body: JSON.stringify({
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `LinkedIn API HTTP ${res.status} ${errText.slice(0, 200)}` }
    }
    const ugcId = res.headers.get('x-restli-id') ?? undefined
    return {
      ok:           true,
      external_id:  ugcId,
      external_url: ugcId ? `https://www.linkedin.com/feed/update/${ugcId}` : undefined,
      response:     { ugc_id: ugcId ?? null },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
