/**
 * POST /api/trading/arm
 *
 * Arms the autonomous execution path (spec sections 2, 11, 14).
 *
 * Required body:
 *   {
 *     trading_mode: 'conservative' | 'balanced' | 'aggressive' | 'manual',
 *     consent_version: number,         // must equal CONSENT_DOC_VERSION
 *     accepts_no_custody: true,        // explicit acknowledgement
 *     accepts_execution_risk: true,    // explicit acknowledgement
 *   }
 *
 * Side effects:
 *   • profiles.full_autotrade_enabled    = true
 *   • profiles.trading_mode              = body.trading_mode
 *   • profiles.autotrade_armed_at        = now()
 *   • profiles.autotrade_consent_version = body.consent_version
 *   • user_consents += { autotrade_arming, version, mode, ip, ua }
 *
 * Pre-conditions enforced:
 *   • user has at least one connected broker (status='connected')
 *   • consent_version matches the deployed CONSENT_DOC_VERSION
 *   • both acceptance flags are true
 *
 * The engine /execute route reads profiles.full_autotrade_enabled and
 * refuses orders when it is false — this endpoint is the only legitimate
 * way to flip that flag on.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  CONSENT_DOC_VERSION, TRADING_MODES, type TradingMode,
} from '@/lib/autotrade'

const armSchema = z.object({
  trading_mode:           z.enum(TRADING_MODES),
  consent_version:        z.number().int().min(1),
  accepts_no_custody:     z.literal(true),
  accepts_execution_risk: z.literal(true),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = armSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }

  if (parsed.data.consent_version !== CONSENT_DOC_VERSION) {
    return NextResponse.json(
      { error: 'Stale consent', current_version: CONSENT_DOC_VERSION },
      { status: 409 },
    )
  }

  // ── Pre-condition: at least one connected broker ─────────────────────
  // Spec section 11: "No execution without explicit account authorization".
  // We refuse to arm if no broker handshake has succeeded yet — flipping
  // the autotrade flag with zero brokers connected is a footgun.
  const { count: connectedCount } = await supabase
    .from('broker_connections')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'connected')

  if (!connectedCount || connectedCount < 1) {
    return NextResponse.json(
      {
        error: 'No connected broker',
        detail: 'Connect at least one broker (status=connected) before arming autonomous execution.',
      },
      { status: 409 },
    )
  }

  const svc = createServiceClient()
  const mode: TradingMode = parsed.data.trading_mode
  const nowIso = new Date().toISOString()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  const { error: updErr } = await svc
    .from('profiles')
    .update({
      full_autotrade_enabled:    true,
      trading_mode:              mode,
      autotrade_armed_at:        nowIso,
      autotrade_disarmed_at:     null,
      autotrade_consent_version: CONSENT_DOC_VERSION,
    })
    .eq('id', user.id)

  if (updErr) {
    console.error('autotrade arm — profile update failed', updErr)
    return NextResponse.json({ error: 'Could not arm autotrade' }, { status: 500 })
  }

  // Audit row — fire-and-forget, never blocks the response.
  svc.from('user_consents').insert({
    user_id:         user.id,
    consent_kind:    'autotrade_arming',
    consent_version: CONSENT_DOC_VERSION,
    trading_mode:    mode,
    ip_address:      ip,
    user_agent:      ua,
  }).then(() => {}, (e) => console.warn('autotrade arm — audit insert failed', e))

  return NextResponse.json({
    ok:                       true,
    trading_mode:             mode,
    autotrade_enabled:        true,
    consent_version:          CONSENT_DOC_VERSION,
    armed_at:                 nowIso,
  })
}
