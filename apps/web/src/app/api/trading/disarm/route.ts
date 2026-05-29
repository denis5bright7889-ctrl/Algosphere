/**
 * POST /api/trading/disarm
 *
 * Cleanly disarms autonomous execution. The engine will then refuse
 * /execute for this user (open positions are NOT closed — pair this
 * with /api/trading/panic-close if the user wants both).
 *
 * Side effects:
 *   • profiles.full_autotrade_enabled  = false
 *   • profiles.autotrade_disarmed_at   = now()
 *   • user_consents += { autotrade_disarming, version }
 *
 * Safe to call when already disarmed (idempotent).
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CONSENT_DOC_VERSION } from '@/lib/autotrade'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const nowIso = new Date().toISOString()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null

  const { error } = await svc
    .from('profiles')
    .update({
      full_autotrade_enabled: false,
      autotrade_disarmed_at:  nowIso,
    })
    .eq('id', user.id)

  if (error) {
    console.error('autotrade disarm failed', error)
    return NextResponse.json({ error: 'Could not disarm' }, { status: 500 })
  }

  svc.from('user_consents').insert({
    user_id:         user.id,
    consent_kind:    'autotrade_disarming',
    consent_version: CONSENT_DOC_VERSION,
    ip_address:      ip,
    user_agent:      ua,
  }).then(() => {}, (e) => console.warn('autotrade disarm — audit insert failed', e))

  return NextResponse.json({
    ok:                true,
    autotrade_enabled: false,
    disarmed_at:       nowIso,
  })
}
