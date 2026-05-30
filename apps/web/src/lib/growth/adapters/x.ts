/**
 * X (Twitter) channel adapter.
 *
 * Env required (OAuth 2.0 User Context, single-user/app):
 *   X_API_KEY              — App API key
 *   X_API_SECRET           — App API secret
 *   X_ACCESS_TOKEN         — User access token (from oauth flow, once)
 *   X_ACCESS_TOKEN_SECRET  — User access token secret
 *
 * Easiest cold-start path: spin up an X Developer App at
 *   https://developer.x.com/en/portal/dashboard
 * with Read+Write permissions, generate the 4 credentials above for
 * the @algospherequant account, drop them in Vercel env, redeploy.
 *
 * This module currently returns 'not implemented' so the audit log
 * shows the channel is intentionally stubbed. To go live: install
 * `twitter-api-v2` and call `v2.tweetThread(formatted.chunks)`.
 */
import type { AdapterResult } from './telegram'

export async function postToX(_text: string, _chunks?: string[]): Promise<AdapterResult> {
  const k = process.env.X_API_KEY
  if (!k) return { ok: false, error: 'X adapter not configured — set X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_TOKEN_SECRET in Vercel env, then install twitter-api-v2 and wire postToX().' }

  return { ok: false, error: 'X adapter env present but library not installed yet — run `npm i twitter-api-v2` and complete this module.' }
}
