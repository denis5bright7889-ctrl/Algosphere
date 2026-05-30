/**
 * Discord channel adapter — posts via a webhook URL.
 *
 * Env:
 *   GROWTH_DISCORD_WEBHOOK_URL — full webhook URL from
 *     Server Settings → Integrations → Webhooks → "Copy URL".
 *
 * Discord webhooks don't require OAuth — anyone holding the URL can
 * post. Keep it as a secret. Webhooks are scoped to a single channel
 * by design.
 */
import type { AdapterResult } from './telegram'

export async function postToDiscord(text: string): Promise<AdapterResult> {
  const url = process.env.GROWTH_DISCORD_WEBHOOK_URL
  if (!url) return { ok: false, error: 'GROWTH_DISCORD_WEBHOOK_URL not configured' }

  try {
    // Append ?wait=true so the response includes the created message
    // (otherwise Discord returns 204 with empty body and we lose the
    // message id needed for the deep link).
    const endpoint = url + (url.includes('?') ? '&' : '?') + 'wait=true'
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        // 2000-char ceiling enforced by Discord. The channel
        // formatter already truncates, but cap defensively.
        content: text.slice(0, 2000),
        allowed_mentions: { parse: [] },
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        ok:    false,
        error: `Discord webhook HTTP ${res.status} ${errText.slice(0, 200)}`,
        response: { status: res.status },
      }
    }

    const json = (await res.json().catch(() => ({}))) as {
      id?: string
      channel_id?: string
    }
    const messageId = json.id
    const channelId = json.channel_id
    return {
      ok:           true,
      external_id:  messageId,
      external_url: messageId && channelId
        ? `https://discord.com/channels/@me/${channelId}/${messageId}`
        : undefined,
      response: { message_id: messageId ?? null, channel_id: channelId ?? null },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
