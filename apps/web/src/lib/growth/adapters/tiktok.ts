/**
 * TikTok channel adapter — Content Posting API.
 *
 * Honest state on 2026-06-04:
 *   - TikTok requires a registered developer app + Content Posting API
 *     scope approval (typically 2-4 weeks). Until approved, no API key
 *     can post a real video to the platform.
 *   - The upload itself is a two-phase flow: POST /v2/post/publish/inbox/video/init/
 *     returns a publish_id + upload_url, the worker uploads the MP4 via
 *     a presigned PUT, then the publish_id is polled until status='ok'.
 *   - User-account tokens (not page tokens) — TikTok has no concept of
 *     a "business page bot." The operator must complete the OAuth
 *     flow with their personal/creator account.
 *
 * Env required when approved:
 *   TIKTOK_ACCESS_TOKEN   — user OAuth token (12-hour TTL, refreshable)
 *   TIKTOK_OPEN_ID        — the user's open_id (returned by OAuth)
 *
 * Text-only posts: TikTok does NOT accept text-only posts; every
 * publication must include a video URL. Until the asset-worker
 * produces an MP4 and uploads it (Remotion path), this adapter
 * returns a labelled skip so the audit log is clear.
 *
 * Future wiring (once OAuth + approval are live):
 *   - Accept a video_url param sourced from content_item.asset_urls
 *   - POST init with source.video_url = supabase storage public URL
 *   - Poll publish_id status until 'PUBLISH_COMPLETE'
 *   - Return external_url = https://www.tiktok.com/@<username>/video/<id>
 */
import type { AdapterResult } from './telegram'

export async function postToTikTok(
  text: string,
  videoUrl?: string | null,
): Promise<AdapterResult> {
  const token  = process.env.TIKTOK_ACCESS_TOKEN
  const openId = process.env.TIKTOK_OPEN_ID

  if (!token || !openId) {
    return {
      ok: false,
      error: 'TikTok adapter not configured — set TIKTOK_ACCESS_TOKEN + TIKTOK_OPEN_ID after completing TikTok for Developers app review + OAuth flow.',
    }
  }
  if (!videoUrl) {
    return {
      ok: false,
      error: 'TikTok requires a video — text-only posts are not supported. Provide a video asset via content_item.asset_urls.',
    }
  }

  try {
    const initRes = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          source_info: {
            source:    'PULL_FROM_URL',
            video_url: videoUrl,
          },
          post_info: {
            title:                  text.slice(0, 150),
            privacy_level:          'SELF_ONLY',
            disable_duet:           false,
            disable_comment:        false,
            disable_stitch:         false,
            video_cover_timestamp_ms: 1000,
          },
        }),
      },
    )
    const initJson = await initRes.json() as {
      data?:  { publish_id?: string }
      error?: { code?: string; message?: string }
    }
    if (!initRes.ok || initJson.error?.code !== 'ok' || !initJson.data?.publish_id) {
      return {
        ok: false,
        error: `TikTok init failed: ${initJson.error?.message ?? `HTTP ${initRes.status}`}`,
        response: initJson as Record<string, unknown>,
      }
    }

    // TikTok's PULL_FROM_URL path is async — the publish_id resolves
    // over 10-60s. The scheduler is fire-and-forget so we return the
    // publish_id immediately; operator can poll status via the TikTok
    // admin dashboard if needed.
    return {
      ok:          true,
      external_id: initJson.data.publish_id,
      external_url: `https://www.tiktok.com/inbox/?publish_id=${initJson.data.publish_id}`,
      response:    initJson as Record<string, unknown>,
    }
  } catch (err) {
    return {
      ok:    false,
      error: err instanceof Error ? err.message : 'TikTok request failed',
    }
  }
}
