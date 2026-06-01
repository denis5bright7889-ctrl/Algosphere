/**
 * Shared Discord notifier — one entry point for every subsystem
 * (Growth Engine, signal worker, ops, support, etc.) to post to
 * its dedicated channel.
 *
 * 14 webhook envs are recognised. Each routes to a single Discord
 * channel; URLs are read fresh on every call so rotation takes
 * effect on the next post (no restart needed).
 *
 * Compliance: this is application notification only — no marketing
 * narrative or content lifecycle. Marketing posts MUST go through
 * lib/growth/* which enforces the disclaimer + provenance contract.
 */

export type DiscordChannel =
  // Growth Engine — also used by lib/growth/adapters/discord.ts
  | 'general' | 'announcements' | 'market_intel'
  | 'algo_updates' | 'education'
  // Signal worker
  | 'signals_free' | 'signals_premium' | 'signals_whales'
  // Auto-trading / execution
  | 'trades' | 'rejections'
  // Ops / engine
  | 'health' | 'admin'
  // Inbound user channels
  | 'support' | 'bug_reports'

const CHANNEL_ENV: Record<DiscordChannel, string> = {
  general:         'DISCORD_WEBHOOK_GENERAL_URL',
  announcements:   'DISCORD_WEBHOOK_ANNOUNCEMENTS_URL',
  market_intel:    'DISCORD_WEBHOOK_MARKET_INTEL_URL',
  algo_updates:    'DISCORD_WEBHOOK_ALGO_UPDATES_URL',
  education:       'DISCORD_WEBHOOK_EDUCATION_URL',

  signals_free:    'DISCORD_WEBHOOK_SIGNALS_FREE_URL',
  signals_premium: 'DISCORD_WEBHOOK_SIGNALS_PREMIUM_URL',
  signals_whales:  'DISCORD_WEBHOOK_SIGNALS_WHALES_URL',

  trades:          'DISCORD_WEBHOOK_TRADES_URL',
  rejections:      'DISCORD_WEBHOOK_REJECTIONS_TRANSPARENCY_URL',

  health:          'DISCORD_WEBHOOK_HEALTH_URL',
  admin:           'DISCORD_WEBHOOK_ADMIN_URL',

  support:         'DISCORD_WEBHOOK_SUPPORT_URL',
  bug_reports:     'DISCORD_WEBHOOK_BUG_REPORTS_URL',
}

export interface NotifyResult {
  ok:           boolean
  channel:      DiscordChannel
  external_id?: string
  error?:       string
}

export interface NotifyOptions {
  /**
   * Rich-content embed (Discord). If text + embed are both provided,
   * the text appears above the embed card.
   */
  embed?: {
    title?:      string
    description?: string
    color?:      number              // decimal int — e.g. 0xF59E0B → amber
    fields?:     Array<{ name: string; value: string; inline?: boolean }>
    footer?:     { text: string }
    timestamp?:  string              // ISO 8601
    url?:        string
  }
  /**
   * If true, the webhook URL is read but no POST is made. Used to
   * test routing without firing.
   */
  dry?: boolean
}

/**
 * Post to a named Discord channel.
 *
 * Returns ok:false with a clear `error` when the env var isn't set —
 * callers should log this but never crash on it (notifications must
 * never break the primary flow they observe).
 */
export async function notifyDiscord(
  channel: DiscordChannel,
  text:    string,
  opts?:   NotifyOptions,
): Promise<NotifyResult> {
  const envKey = CHANNEL_ENV[channel]
  const url    = process.env[envKey]
  if (!url) {
    return { ok: false, channel, error: `${envKey} not configured` }
  }
  if (opts?.dry) {
    return { ok: true, channel }
  }

  try {
    const endpoint = url + (url.includes('?') ? '&' : '?') + 'wait=true'
    const body: Record<string, unknown> = {
      content: text.slice(0, 2000),
      allowed_mentions: { parse: [] },
    }
    if (opts?.embed) body.embeds = [opts.embed]

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, channel, error: `HTTP ${res.status} ${errText.slice(0, 200)}` }
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, channel, external_id: json.id }
  } catch (e) {
    return { ok: false, channel, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/**
 * Convenience helpers — semantic shorthands the rest of the codebase
 * can call without thinking about the channel name.
 */
export const notify = {
  health:     (text: string, opts?: NotifyOptions) => notifyDiscord('health',     text, opts),
  admin:      (text: string, opts?: NotifyOptions) => notifyDiscord('admin',      text, opts),
  support:    (text: string, opts?: NotifyOptions) => notifyDiscord('support',    text, opts),
  bugReport:  (text: string, opts?: NotifyOptions) => notifyDiscord('bug_reports', text, opts),
  trade:      (text: string, opts?: NotifyOptions) => notifyDiscord('trades',     text, opts),
  rejection:  (text: string, opts?: NotifyOptions) => notifyDiscord('rejections', text, opts),
  signal: (tier: 'free' | 'premium' | 'whales', text: string, opts?: NotifyOptions) => {
    const ch: DiscordChannel = tier === 'whales'  ? 'signals_whales'
                             : tier === 'premium' ? 'signals_premium'
                             :                       'signals_free'
    return notifyDiscord(ch, text, opts)
  },
}

// Embed colour palette — keeps notifications visually consistent.
export const EMBED_COLOR = {
  ok:       0x10b981, // emerald
  warn:     0xf59e0b, // amber
  critical: 0xef4444, // rose
  info:     0x60a5fa, // sky
  amber:    0xf59e0b,
} as const
