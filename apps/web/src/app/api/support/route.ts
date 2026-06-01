/**
 * /api/support — user-submitted support request.
 *
 * Forwards to the Discord support channel via DISCORD_WEBHOOK_SUPPORT_URL.
 * Persists nothing in the DB for now — Discord is the authoritative
 * inbox until a proper ticketing schema lands.
 *
 * Authenticated users only. Rate-limited to 5/hour per user.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'

export const dynamic = 'force-dynamic'

const schema = z.object({
  category: z.enum(['account', 'billing', 'broker', 'feature_request', 'other']),
  subject:  z.string().min(3).max(120),
  message:  z.string().min(10).max(4000),
})

// Coarse 5/hour rate limit per user, in-memory (best-effort).
// For prod-grade limiting wire Redis; this is enough to keep a bot
// from flooding the channel.
const LIMIT_WINDOW_MS = 60 * 60 * 1000
const LIMIT_PER_USER  = 5
const _attempts = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const recent = (_attempts.get(userId) ?? []).filter(t => now - t < LIMIT_WINDOW_MS)
  if (recent.length >= LIMIT_PER_USER) return true
  recent.push(now)
  _attempts.set(userId, recent)
  return false
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (rateLimited(user.id)) {
    return NextResponse.json({ error: 'Too many requests — try again in an hour.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }
  const { category, subject, message } = parsed.data

  const result = await notify.support(
    `**${subject}**`,
    {
      embed: {
        title:       subject,
        description: message,
        color:       EMBED_COLOR.info,
        fields: [
          { name: 'Category', value: category, inline: true },
          { name: 'User',     value: user.email ?? user.id, inline: true },
        ],
        footer:    { text: `User id: ${user.id}` },
        timestamp: new Date().toISOString(),
      },
    },
  )

  if (!result.ok) {
    // Don't expose the env-var name to the client — log it and respond
    // generically. Once Discord is configured this never fires.
    console.error('Support notify failed:', result.error)
    return NextResponse.json({ error: 'Support channel unavailable right now — please email support@algospherequant.com.' }, { status: 503 })
  }

  return NextResponse.json({ ok: true })
}
