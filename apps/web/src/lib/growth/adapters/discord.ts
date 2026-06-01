/**
 * Discord channel adapter — multi-webhook routing.
 *
 * Each content kind posts to a different Discord channel (you've set
 * up 14 webhooks). The adapter picks the webhook URL from env based
 * on either:
 *   1. An explicit `target` override on the schedule row.
 *   2. The content_item.kind via KIND_TO_TARGET.
 *   3. The legacy single-webhook fallback (GROWTH_DISCORD_WEBHOOK_URL).
 *   4. The general channel (DISCORD_WEBHOOK_GENERAL_URL).
 *
 * Resolution order is documented in pickWebhookUrl() so the audit log
 * can be reasoned about. Webhook URLs are read fresh on every call —
 * env-var rotation takes effect on the next post (no restart needed).
 *
 * NB: only the FIVE Growth-Engine-owned webhooks are routed here:
 *     GENERAL · ANNOUNCEMENTS · MARKET_INTEL · ALGO_UPDATES · EDUCATION
 * The other 9 (signals, trades, health, admin, etc.) belong to other
 * subsystems and are surfaced in their own slices.
 */
import type { AdapterResult } from './telegram'

export type DiscordGrowthTarget =
  | 'general' | 'announcements' | 'market_intel'
  | 'algo_updates' | 'education'

const TARGET_ENV: Record<DiscordGrowthTarget, string> = {
  general:       'DISCORD_WEBHOOK_GENERAL_URL',
  announcements: 'DISCORD_WEBHOOK_ANNOUNCEMENTS_URL',
  market_intel:  'DISCORD_WEBHOOK_MARKET_INTEL_URL',
  algo_updates:  'DISCORD_WEBHOOK_ALGO_UPDATES_URL',
  education:     'DISCORD_WEBHOOK_EDUCATION_URL',
}

/**
 * Content kind → default Discord channel mapping. Tuned to the
 * channel naming you chose so each kind lands where it makes sense.
 */
const KIND_TO_TARGET: Record<string, DiscordGrowthTarget> = {
  strategy_of_the_week: 'algo_updates',
  backtest_breakdown:   'algo_updates',
  market_report:        'market_intel',
  product_update:       'announcements',
  announcement:         'announcements',
  psychology_insight:   'education',
  educational:          'education',
}

function pickWebhookUrl(opts: { target?: DiscordGrowthTarget; contentKind?: string }): {
  url:    string | null
  picked: string                 // human label for the audit log
} {
  // 1. Explicit override on the schedule row.
  if (opts.target) {
    const envKey = TARGET_ENV[opts.target]
    const url = process.env[envKey]
    if (url) return { url, picked: `explicit:${opts.target}` }
  }

  // 2. Content-kind-derived target.
  if (opts.contentKind) {
    const target = KIND_TO_TARGET[opts.contentKind]
    if (target) {
      const url = process.env[TARGET_ENV[target]]
      if (url) return { url, picked: `kind:${opts.contentKind}→${target}` }
    }
  }

  // 3. Legacy single-webhook fallback (Phase 2 default).
  const legacy = process.env.GROWTH_DISCORD_WEBHOOK_URL
  if (legacy) return { url: legacy, picked: 'legacy_growth_webhook' }

  // 4. General channel (catches everything if all else fails).
  const general = process.env.DISCORD_WEBHOOK_GENERAL_URL
  if (general) return { url: general, picked: 'fallback:general' }

  return { url: null, picked: 'none' }
}

export async function postToDiscord(
  text:  string,
  opts?: { target?: DiscordGrowthTarget; contentKind?: string },
): Promise<AdapterResult> {
  const { url, picked } = pickWebhookUrl(opts ?? {})
  if (!url) {
    return {
      ok:    false,
      error: 'No Discord webhook configured. Set at least DISCORD_WEBHOOK_GENERAL_URL in Vercel env.',
    }
  }

  try {
    const endpoint = url + (url.includes('?') ? '&' : '?') + 'wait=true'
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        content: text.slice(0, 2000),
        allowed_mentions: { parse: [] },
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        ok:       false,
        error:    `Discord webhook HTTP ${res.status} ${errText.slice(0, 200)} (target=${picked})`,
        response: { status: res.status, picked },
      }
    }

    const json = (await res.json().catch(() => ({}))) as {
      id?: string
      channel_id?: string
    }
    return {
      ok:           true,
      external_id:  json.id,
      external_url: json.id && json.channel_id
        ? `https://discord.com/channels/@me/${json.channel_id}/${json.id}`
        : undefined,
      response: {
        message_id: json.id ?? null,
        channel_id: json.channel_id ?? null,
        picked,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
