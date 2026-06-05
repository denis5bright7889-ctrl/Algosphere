/**
 * Telegram channel adapter — posts a formatted message to a configured
 * chat or channel via the Bot API.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN          — required, same token the bot uses
 *   GROWTH_TELEGRAM_CHANNEL_ID  — chat id ( @channelname or numeric)
 *
 * Returns a normalised result the scheduler can persist into the
 * growth_post_attempts log without leaking the full provider envelope.
 */

export interface AdapterResult {
  ok:           boolean
  external_id?: string
  external_url?: string
  /** Trimmed provider response — anything we want surfaced in the
   *  audit log. Keep it to scalar fields. */
  response?:    Record<string, unknown>
  error?:       string
}

interface TelegramSendResp {
  ok:     boolean
  result?: { message_id?: number; chat?: { id?: number; username?: string } }
  description?: string
}

export async function postToTelegram(
  text: string,
  opts?: { imageUrl?: string; videoUrl?: string },
): Promise<AdapterResult> {
  const token   = process.env.TELEGRAM_BOT_TOKEN
  const chatId  = process.env.GROWTH_TELEGRAM_CHANNEL_ID

  if (!token)  return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  if (!chatId) return { ok: false, error: 'GROWTH_TELEGRAM_CHANNEL_ID not configured' }

  // Telegram fetches media by URL. sendVideo/sendPhoto cap captions at
  // 1024 chars (plain messages allow 4096), so media posts get a trimmed
  // caption. Falls back to a text message when no media is attached.
  const method =
    opts?.videoUrl ? 'sendVideo' : opts?.imageUrl ? 'sendPhoto' : 'sendMessage'
  const payload: Record<string, unknown> =
    method === 'sendVideo'
      ? { chat_id: chatId, video: opts!.videoUrl, caption: text.slice(0, 1024), parse_mode: 'Markdown', supports_streaming: true }
    : method === 'sendPhoto'
      ? { chat_id: chatId, photo: opts!.imageUrl, caption: text.slice(0, 1024), parse_mode: 'Markdown' }
      : { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: false }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
    )
    const json = (await res.json().catch(() => ({}))) as TelegramSendResp
    if (!res.ok || !json.ok) {
      return {
        ok:    false,
        error: json.description ?? `Telegram API HTTP ${res.status}`,
        response: { status: res.status, description: json.description ?? null, method },
      }
    }

    const messageId = json.result?.message_id
    const username  = json.result?.chat?.username
    return {
      ok:           true,
      external_id:  messageId != null ? String(messageId) : undefined,
      external_url: username && messageId
        ? `https://t.me/${username}/${messageId}`
        : undefined,
      response: {
        message_id: messageId ?? null,
        chat_username: username ?? null,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
