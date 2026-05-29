/**
 * POST /api/trading/panic-close
 *
 * Spec section 10: "emergency close-all". Flattens every open position
 * across every connected broker for the calling user, and disarms
 * autonomous execution in the same atomic flow so signals stop firing.
 *
 * Optional body:  { reason?: string }
 *
 * Side effects:
 *   • engine POST /api/v1/trading/panic-close fans out reduce_only
 *     market orders to flatten positions; returns per-position results.
 *   • profiles.full_autotrade_enabled is forced false.
 *   • panic_close_events row is inserted with the engine response.
 *   • user_consents += { panic_close, version } — for the audit chain.
 *
 * Tolerant of engine partial failure: any positions the engine could
 * not close are returned in the response. The user is shown a per-
 * position outcome and must follow up manually for the failed ones.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CONSENT_DOC_VERSION } from '@/lib/autotrade'

const PANIC_TIMEOUT_MS = 60_000  // MT5 re-login is slow; give it room

const bodySchema = z.object({
  reason: z.string().max(240).optional(),
}).optional()

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw ?? undefined)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }
  const reason = parsed.data?.reason ?? null

  const engineUrl = process.env.SIGNAL_ENGINE_URL
  const engineKey = process.env.ENGINE_API_KEY ?? ''
  if (!engineUrl) {
    return NextResponse.json({ error: 'engine_not_configured' }, { status: 503 })
  }

  // ── Disarm first ─────────────────────────────────────────────────────
  // Order matters: we flip the flag BEFORE asking the engine to flatten
  // so a slow MT5 round-trip can't fire one more open trade in the
  // window between user click and engine response. If the engine
  // flatten partially fails the user is still disarmed.
  const svc = createServiceClient()
  const nowIso = new Date().toISOString()
  await svc
    .from('profiles')
    .update({
      full_autotrade_enabled: false,
      autotrade_disarmed_at:  nowIso,
    })
    .eq('id', user.id)

  // ── Engine round-trip ────────────────────────────────────────────────
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PANIC_TIMEOUT_MS)

  let engineResult: unknown = null
  let engineError: string | null = null
  try {
    const res = await fetch(`${engineUrl.replace(/\/$/, '')}/api/v1/trading/panic-close`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(engineKey ? { 'x-engine-key': engineKey } : {}),
      },
      body: JSON.stringify({ user_id: user.id, reason }),
      cache: 'no-store',
    })
    if (!res.ok) {
      engineError = `engine HTTP ${res.status}`
    } else {
      engineResult = await res.json()
    }
  } catch (e) {
    engineError = e instanceof Error
      ? (e.name === 'AbortError' ? 'engine_timeout' : e.message)
      : 'engine_unreachable'
  } finally {
    clearTimeout(timer)
  }

  // ── Audit trail ──────────────────────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null
  const engineObj = engineResult && typeof engineResult === 'object'
    ? engineResult as Record<string, unknown>
    : null
  const brokers = Array.isArray(engineObj?.brokers_attempted)
    ? engineObj!.brokers_attempted as string[]
    : []
  const closed = typeof engineObj?.positions_closed === 'number'
    ? engineObj!.positions_closed as number
    : 0

  svc.from('panic_close_events').insert({
    user_id:          user.id,
    triggered_at:     nowIso,
    brokers,
    positions_closed: closed,
    reason,
    ip_address:       ip,
    user_agent:       ua,
    engine_response:  engineResult ?? { error: engineError },
  }).then(() => {}, (e) => console.warn('panic_close audit insert failed', e))

  svc.from('user_consents').insert({
    user_id:         user.id,
    consent_kind:    'panic_close',
    consent_version: CONSENT_DOC_VERSION,
    ip_address:      ip,
    user_agent:      ua,
  }).then(() => {}, (e) => console.warn('panic_close consent insert failed', e))

  if (engineError) {
    return NextResponse.json({
      ok:             false,
      disarmed:       true,
      engine_error:   engineError,
      detail:         'Autotrade has been disarmed but the engine could not be reached to flatten positions. Check /brokers and close manually if needed.',
    }, { status: 502 })
  }

  return NextResponse.json({
    ok:        true,
    disarmed:  true,
    engine:    engineResult,
  })
}
