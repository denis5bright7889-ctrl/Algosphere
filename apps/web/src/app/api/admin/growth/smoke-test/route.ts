/**
 * /api/admin/growth/smoke-test — fire a real test post to every
 * channel that has env credentials configured.
 *
 * Body (optional):
 *   { channels?: DiscordChannel[] }   — restrict to a subset
 *   { dry?: boolean }                 — read env + format but skip POST
 *
 * Returns a per-channel result with ok / error / external_id so the
 * operator sees exactly which integrations are live.
 *
 * Admin-only. Identifiable test payload so the post is obviously a
 * smoke-test and not a real signal/announcement.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import {
  notifyDiscord, EMBED_COLOR, type DiscordChannel,
} from '@/lib/notifications/discord'
import { postToTelegram } from '@/lib/growth/adapters/telegram'
import { postToFacebook, postToInstagram } from '@/lib/growth/adapters/meta'
import { postToLinkedIn } from '@/lib/growth/adapters/linkedin'

export const dynamic = 'force-dynamic'

const DISCORD_CHANNELS: DiscordChannel[] = [
  'general', 'announcements', 'market_intel', 'algo_updates', 'education',
  'signals_free', 'signals_premium', 'signals_whales',
  'trades', 'rejections',
  'health', 'admin',
  'support', 'bug_reports',
]

const schema = z.object({
  channels: z.array(z.string()).optional(),
  dry:      z.boolean().optional(),
}).default({})

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

interface Result {
  channel:     string
  ok:          boolean
  external_id?: string
  external_url?: string
  error?:      string
  skipped?:    string                 // 'dry-run' or 'not_configured'
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }
  const { channels, dry } = parsed.data

  const stamp = new Date().toISOString()
  const probe = `🧪 **Smoke test** — ${stamp}\nfired by ${g.user.email ?? g.user.id}\n_This is a one-off integration check. No user-facing event happened._`

  const results: Result[] = []
  const want = (k: string) => !channels || channels.includes(k)

  // ── Discord — every channel that has its env set
  for (const ch of DISCORD_CHANNELS) {
    if (!want(`discord:${ch}`)) continue
    if (dry) {
      results.push({ channel: `discord:${ch}`, ok: true, skipped: 'dry-run' })
      continue
    }
    const r = await notifyDiscord(ch, probe, {
      embed: {
        title:       'Smoke test',
        description: 'If you can read this, the webhook + adapter wiring for **' + ch + '** is live.',
        color:       EMBED_COLOR.info,
        timestamp:   stamp,
      },
    })
    results.push({
      channel:     `discord:${ch}`,
      ok:          r.ok,
      external_id: r.external_id,
      error:       r.error,
    })
  }

  // ── Telegram
  if (want('telegram')) {
    if (dry) {
      results.push({ channel: 'telegram', ok: true, skipped: 'dry-run' })
    } else {
      const r = await postToTelegram(probe)
      results.push({
        channel:      'telegram',
        ok:           r.ok,
        external_id:  r.external_id,
        external_url: r.external_url,
        error:        r.error,
      })
    }
  }

  // ── Facebook
  if (want('facebook')) {
    if (dry) {
      results.push({ channel: 'facebook', ok: true, skipped: 'dry-run' })
    } else {
      const r = await postToFacebook(probe)
      results.push({
        channel:     'facebook',
        ok:          r.ok,
        external_id: r.external_id,
        error:       r.error,
      })
    }
  }

  // ── Instagram — REQUIRES a hero image. Smoke-test uses a publicly
  //    hosted placeholder PNG so the adapter has something to render.
  if (want('instagram')) {
    if (dry) {
      results.push({ channel: 'instagram', ok: true, skipped: 'dry-run' })
    } else {
      const heroUrl = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/opengraph-image.png`
        : 'https://algospherequant.com/opengraph-image.png'
      const r = await postToInstagram(probe, heroUrl)
      results.push({
        channel:     'instagram',
        ok:          r.ok,
        external_id: r.external_id,
        error:       r.error,
      })
    }
  }

  // ── LinkedIn
  if (want('linkedin')) {
    if (dry) {
      results.push({ channel: 'linkedin', ok: true, skipped: 'dry-run' })
    } else {
      const r = await postToLinkedIn(probe)
      results.push({
        channel:      'linkedin',
        ok:           r.ok,
        external_id:  r.external_id,
        external_url: r.external_url,
        error:        r.error,
      })
    }
  }

  return NextResponse.json({
    fired_at: stamp,
    summary: {
      total:     results.length,
      succeeded: results.filter((r) => r.ok && !r.skipped).length,
      failed:    results.filter((r) => !r.ok && !r.skipped).length,
      skipped:   results.filter((r) =>  r.skipped).length,
    },
    results,
  })
}
