/**
 * Telegram notifier — server-only. Sends a single message to a user's
 * Telegram chat via the Bot API (TELEGRAM_BOT_TOKEN env).
 *
 * Design contract:
 *   • Best-effort. Returns {ok,...} but never throws — callers must
 *     never let a Telegram outage block the underlying business action
 *     (e.g. trade settlement must still succeed if Telegram is down).
 *   • Silent no-op when prerequisites aren't met: missing token, missing
 *     chat_id, empty text. We do NOT log "Telegram skipped" to UI.
 *   • Honest: no fake retries, no enqueue/forget illusion. One attempt
 *     with a short timeout; the caller can decide whether to retry.
 */

const TIMEOUT_MS = 4000

export interface NotifyResult {
  ok:       boolean
  status?:  number
  skipped?: 'no_token' | 'no_chat_id' | 'empty_text'
  error?:   string
}

export async function notifyTelegram(
  chatId: number | string | null | undefined,
  text:   string,
): Promise<NotifyResult> {
  if (!chatId)        return { ok: false, skipped: 'no_chat_id' }
  if (!text?.trim())  return { ok: false, skipped: 'empty_text' }

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, skipped: 'no_token' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               'HTML',
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
    })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? 'timeout' : e.message)
      : 'fetch failed'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Compose a "trade closed" message from real settlement fields. */
export function tradeClosedMessage(args: {
  symbol:    string
  direction: string
  pnl:       number
  pnlPct?:   number | null
  pips?:     number | null
}): string {
  const won = args.pnl >= 0
  const head = won ? '🟢 <b>Trade closed</b>' : '🔴 <b>Trade closed</b>'
  const pnlLine = `P&amp;L: <b>${won ? '+' : ''}$${args.pnl.toFixed(2)}</b>`
    + (args.pnlPct != null ? ` (${args.pnlPct >= 0 ? '+' : ''}${args.pnlPct.toFixed(2)}%)` : '')
  const pipsLine = args.pips != null ? `\nPips: ${args.pips >= 0 ? '+' : ''}${args.pips}` : ''
  return [
    head,
    `${args.direction.toUpperCase()} ${args.symbol}`,
    pnlLine + pipsLine,
  ].join('\n')
}
