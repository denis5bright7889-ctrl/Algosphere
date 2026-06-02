/**
 * /api/track/event — attribution + funnel pixel.
 *
 * Public POST endpoint. Reads __as_vid cookie (set by middleware),
 * upserts a row in growth_visitors on first contact, then appends an
 * event row to growth_attribution_events.
 *
 * Idempotency: we don't dedup at the table level (every event is a
 * real signal), but visitor first-touch is preserved by INSERT-only
 * upsert + ON CONFLICT DO NOTHING on visitor_id. Subsequent events
 * for the same visitor just update last_seen_at.
 *
 * Authentication: anon. The pixel must be hittable from any page
 * including the marketing site. Funnel data integrity comes from
 * the server-only growth_attribution_events INSERT (RLS denies
 * direct user-facing writes; only the service-role client used here
 * can write).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CANONICAL_EVENTS = [
  'pageview', 'signup',
  'broker_connected', 'trade_synced',
  'journal_created', 'strategy_created',
  'premium_upgrade', 'churn',
] as const

const schema = z.object({
  event:      z.string().min(2).max(40),
  path:       z.string().max(500).optional(),
  referrer:   z.string().max(500).optional(),
  source_kind: z.enum(['organic','direct','referral','email','social','community','paid']).optional(),
  source_id:  z.string().max(200).optional(),
  utm_source: z.string().max(60).optional(),
  utm_medium: z.string().max(60).optional(),
  utm_campaign: z.string().max(80).optional(),
  utm_content: z.string().max(80).optional(),
  payload:    z.record(z.string(), z.unknown()).optional(),
})

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 200 })  // never error the pixel
  const e = parsed.data

  // Read the visitor id from the cookie. Middleware sets it on first
  // touch; if absent (e.g. bot, cookies disabled) we still log the
  // event but without visitor linkage.
  const cookieHeader = req.headers.get('cookie') ?? ''
  const visitorId = cookieHeader.match(/__as_vid=([0-9a-f-]{8,})/i)?.[1] ?? null

  // Link to user if logged in (signup / journal / strategy etc).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  const db = svc()

  // Upsert visitor row on first contact.
  if (visitorId) {
    await db.from('growth_visitors').upsert({
      visitor_id:         visitorId,
      first_referrer:     e.referrer,
      first_utm_source:   e.utm_source,
      first_utm_medium:   e.utm_medium,
      first_utm_campaign: e.utm_campaign,
      first_utm_content:  e.utm_content,
      first_landing_path: e.path,
      first_user_agent:   req.headers.get('user-agent') ?? null,
      first_source:       e.source_kind ?? deriveSource(e.referrer),
      last_seen_at:       new Date().toISOString(),
      last_landing_path:  e.path,
      user_id:            userId,
    }, { onConflict: 'visitor_id', ignoreDuplicates: false })

    // After signup, link the visitor to the user (idempotent — only
    // updates rows where user_id is currently NULL).
    if (userId) {
      await db.from('growth_visitors')
        .update({ user_id: userId })
        .eq('visitor_id', visitorId)
        .is('user_id', null)
    }
  }

  // Append the event.
  await db.from('growth_attribution_events').insert({
    event:        e.event,
    visitor_id:   visitorId,
    user_id:      userId,
    source_kind:  e.source_kind ?? deriveSource(e.referrer),
    source_id:    e.source_id,
    utm_source:   e.utm_source,
    utm_medium:   e.utm_medium,
    utm_campaign: e.utm_campaign,
    utm_content:  e.utm_content,
    referrer:     e.referrer,
    path:         e.path,
    payload:      e.payload ?? {},
  })

  return NextResponse.json({
    ok:          true,
    visitor_id:  visitorId,
    canonical:   (CANONICAL_EVENTS as readonly string[]).includes(e.event),
  })
}

function deriveSource(referrer: string | null | undefined): string {
  if (!referrer || referrer.trim() === '') return 'direct'
  try {
    const u = new URL(referrer)
    const h = u.hostname.replace(/^www\./, '')
    if (h.endsWith('algospherequant.com')) return 'direct'
    if (/google|bing|duckduckgo|yandex|yahoo/.test(h)) return 'organic'
    if (/twitter|x\.com|t\.co|linkedin|facebook|instagram|reddit|discord|telegram|youtube/.test(h)) return 'social'
    return 'referral'
  } catch {
    return 'direct'
  }
}
