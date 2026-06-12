/**
 * /api/bug-report — user-submitted bug report.
 *
 * Forwards to the Discord bug-reports channel via
 * DISCORD_WEBHOOK_BUG_REPORTS_URL. Optional anonymous mode allows
 * users without an account to report (e.g. login-bricked).
 *
 * Rate-limited to 5/hour per user (or per IP for anon).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'

export const dynamic = 'force-dynamic'

const schema = z.object({
  severity:    z.enum(['low', 'medium', 'high', 'critical']),
  title:       z.string().min(3).max(120),
  description: z.string().min(20).max(4000),
  url:         z.string().url().optional(),                   // page where bug happened
  steps:       z.string().max(2000).optional(),
  user_agent:  z.string().max(500).optional(),                // navigator.userAgent
})

const LIMIT_WINDOW_MS = 60 * 60 * 1000
const LIMIT_PER_KEY   = 5
const _attempts = new Map<string, number[]>()
function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (_attempts.get(key) ?? []).filter(t => now - t < LIMIT_WINDOW_MS)
  if (recent.length >= LIMIT_PER_KEY) return true
  recent.push(now)
  _attempts.set(key, recent)
  return false
}

const SEVERITY_COLOR: Record<string, number> = {
  low:      EMBED_COLOR.info,
  medium:   EMBED_COLOR.amber,
  high:     EMBED_COLOR.warn,
  critical: EMBED_COLOR.critical,
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ipKey = xff ?? 'anon'
  const rateKey = user?.id ?? `ip:${ipKey}`
  if (rateLimited(rateKey)) {
    return NextResponse.json({ error: 'Too many reports — try again in an hour.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }
  const { severity, title, description, url, steps, user_agent } = parsed.data

  const reporter = user
    ? (user.email ?? user.id)
    : 'Anonymous'

  const fields = [
    { name: 'Severity', value: severity, inline: true },
    { name: 'Reporter', value: reporter, inline: true },
  ]
  if (url)        fields.push({ name: 'URL',         value: url,        inline: false })
  if (steps)      fields.push({ name: 'Repro steps', value: steps.slice(0, 1024), inline: false })
  if (user_agent) fields.push({ name: 'User agent',  value: user_agent.slice(0, 200), inline: false })

  const result = await notify.bugReport(
    `**[${severity.toUpperCase()}]** ${title}`,
    {
      embed: {
        title:       title,
        description: description,
        color:       SEVERITY_COLOR[severity] ?? EMBED_COLOR.info,
        fields,
        footer:      { text: user ? `User id: ${user.id}` : `IP: ${ipKey}` },
        timestamp:   new Date().toISOString(),
      },
    },
  )

  if (!result.ok) {
    console.error('Bug-report notify failed:', result.error)
    return NextResponse.json({ error: 'Bug reporting channel unavailable. Please email info@algospherequant.com.' }, { status: 503 })
  }

  return NextResponse.json({ ok: true })
}
