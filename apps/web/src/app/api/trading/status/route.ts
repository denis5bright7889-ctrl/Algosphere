/**
 * GET /api/trading/status
 *
 * Spec section 1 endpoint. Returns the caller's current autonomous-
 * execution arming state, mode, connected-broker count, and the consent
 * doc version the server expects.
 *
 * Shape:
 *   {
 *     autotrade_enabled: boolean,
 *     trading_mode:      TradingMode,
 *     consent_version:   number,    // version on the user's profile
 *     server_consent_version: number,
 *     consent_up_to_date: boolean,
 *     armed_at:          string | null,
 *     disarmed_at:       string | null,
 *     connected_brokers: number,
 *     live_brokers:      number,
 *     mode_overrides:    { min_confidence, size_multiplier, requires_user_approval }
 *   }
 *
 * Safe to poll. No engine round-trip; pure Supabase read.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  CONSENT_DOC_VERSION, MODE_OVERRIDES, isTradingMode, type TradingMode,
} from '@/lib/autotrade'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: profile }, brokersRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(`
        full_autotrade_enabled, trading_mode,
        autotrade_armed_at, autotrade_disarmed_at, autotrade_consent_version
      `)
      .eq('id', user.id)
      .single(),
    supabase
      .from('broker_connections')
      .select('id, is_live, is_testnet, status')
      .eq('user_id', user.id),
  ])

  const brokers = brokersRes.data ?? []
  const connected = brokers.filter((b) => b.status === 'connected')
  const live      = connected.filter((b) => b.is_live === true && b.is_testnet !== true)

  const rawMode = profile?.trading_mode ?? 'manual'
  const mode: TradingMode = isTradingMode(rawMode) ? rawMode : 'manual'
  const userConsent = profile?.autotrade_consent_version ?? 0

  return NextResponse.json({
    autotrade_enabled:      Boolean(profile?.full_autotrade_enabled),
    trading_mode:           mode,
    consent_version:        userConsent,
    server_consent_version: CONSENT_DOC_VERSION,
    consent_up_to_date:     userConsent >= CONSENT_DOC_VERSION,
    armed_at:               profile?.autotrade_armed_at ?? null,
    disarmed_at:            profile?.autotrade_disarmed_at ?? null,
    connected_brokers:      connected.length,
    live_brokers:           live.length,
    mode_overrides:         MODE_OVERRIDES[mode],
  }, { headers: { 'Cache-Control': 'no-store' } })
}
