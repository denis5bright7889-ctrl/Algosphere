/**
 * Twitter / X webhook receiver — Account Activity API (AAA).
 *
 * Webhook URL to register in the X developer portal:
 *   https://algospherequant.com/api/webhooks/twitter
 *
 * X's Account Activity API has a two-part contract:
 *
 *   1. CRC (Challenge-Response Check) — GET
 *      X periodically GETs the URL with a ?crc_token=… and expects a
 *      JSON { response_token: "sha256=<base64 HMAC-SHA256(crc_token,
 *      CONSUMER_SECRET)>" } within 3s. This proves we own the endpoint
 *      and hold the app secret. X calls it on registration and ~daily.
 *
 *   2. Event delivery — POST
 *      Activity events arrive as POST JSON with an
 *      'x-twitter-webhooks-signature: sha256=<base64>' header — an HMAC
 *      of the raw body under the same CONSUMER_SECRET. We verify it
 *      (constant-time), then durably store the event in `webhook_events`
 *      (provider='twitter') for the Attention/Narrative consumer to drain.
 *
 * Secret: TWITTER_CONSUMER_SECRET (a.k.a. the X app's API/consumer secret).
 * Without it the endpoint responds 503 on CRC so registration fails loudly
 * rather than silently mis-signing.
 *
 * NOTE ON ACCESS: the Account Activity API requires an X API tier that
 * includes AAA (historically Premium/Enterprise). The endpoint is correct
 * regardless; registration just needs the matching access. For lower tiers,
 * a polling consumer against the v2 recent-search endpoint is the
 * alternative — this receiver still works for any service that POSTs
 * X-style signed events at it.
 */
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient as serviceClient } from '@supabase/supabase-js'

// Node runtime required: crypto + raw-body access (not edge).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function consumerSecret(): string {
  return process.env.TWITTER_CONSUMER_SECRET || process.env.X_API_SECRET || ''
}

/** base64( HMAC-SHA256( message, secret ) ) */
function hmacB64(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('base64')
}

// ── CRC challenge (GET) ──────────────────────────────────────────────────

export async function GET(req: Request) {
  const secret = consumerSecret()
  const crcToken = new URL(req.url).searchParams.get('crc_token')

  if (!crcToken) {
    // A bare GET (health check / browser visit) — describe the endpoint.
    return NextResponse.json({
      ok: true,
      endpoint: 'twitter-webhook',
      note: 'Register this URL in the X Account Activity API. GET with ?crc_token returns the CRC response_token.',
      configured: Boolean(secret),
    })
  }
  if (!secret) {
    return NextResponse.json(
      { error: 'TWITTER_CONSUMER_SECRET not configured — cannot answer CRC' },
      { status: 503 },
    )
  }
  // X expects exactly this shape, within 3 seconds.
  return NextResponse.json({ response_token: `sha256=${hmacB64(crcToken, secret)}` })
}

// ── Event delivery (POST) ────────────────────────────────────────────────

export async function POST(req: Request) {
  const secret = consumerSecret()
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // Raw body is required to verify the signature byte-for-byte.
  const raw = await req.text()

  const presented = req.headers.get('x-twitter-webhooks-signature') || ''
  const expected  = `sha256=${hmacB64(raw, secret)}`
  const ok = presented.length === expected.length &&
             crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
  if (!ok) {
    // Bad/absent signature → reject. (X never retries a 4xx on AAA, so this
    // is safe; a genuine X event always carries a valid signature.)
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  // Parse defensively — never lose an authenticated payload.
  let body: unknown
  try { body = JSON.parse(raw) } catch { body = { _raw: raw.slice(0, 10_000) } }

  // X AAA payloads are keyed by activity type, e.g. tweet_create_events,
  // favorite_events, follow_events. Capture the dominant type + a stable id.
  const obj = (body && typeof body === 'object') ? body as Record<string, unknown> : {}
  const eventType =
    Object.keys(obj).find((k) => k.endsWith('_events')) ??
    (typeof obj['for_user_id'] === 'string' ? 'user_event' : 'unknown')
  const externalId =
    (typeof obj['for_user_id'] === 'string' ? obj['for_user_id'] : null) ??
    null

  // Durable, best-effort store. A non-200 would make some senders retry, so
  // we still 200 on a persistence hiccup (the signature already passed).
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && key) {
      const svc = serviceClient(url, key)
      await svc.from('webhook_events').insert({
        provider:     'twitter',
        event_type:   eventType,
        external_id:  externalId ? `${externalId}-${Date.now()}` : null,
        symbol:       null,
        payload:      obj,
        signature_ok: true,
      })
    }
  } catch {
    // Swallow — ingestion is best-effort; the consumer tolerates gaps.
  }

  return NextResponse.json({ ok: true, event: eventType })
}
