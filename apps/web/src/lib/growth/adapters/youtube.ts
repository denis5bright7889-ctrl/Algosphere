/**
 * YouTube channel adapters — long-form videos + Shorts.
 *
 * YouTube has NO native "text post" surface — every "post" is a
 * video upload. For Phase 2 we treat these as stubbed; Phase 4 wires
 * a real upload pipeline once the Video Studio module is built.
 *
 * Env required (when implemented):
 *   YOUTUBE_OAUTH_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN      — minted once via the OAuth flow
 *                                 (https://developers.google.com/youtube/v3/quickstart)
 *
 * Caller must supply a video_url + thumbnail_url.
 */
import type { AdapterResult } from './telegram'

export async function postToYouTube(_text: string, _videoUrl?: string): Promise<AdapterResult> {
  return { ok: false, error: 'YouTube adapter requires video upload — implemented in Phase 4 (Video Studio).' }
}

export async function postToYouTubeShorts(_text: string, _videoUrl?: string): Promise<AdapterResult> {
  return { ok: false, error: 'YouTube Shorts adapter requires video upload — implemented in Phase 4 (Video Studio).' }
}
