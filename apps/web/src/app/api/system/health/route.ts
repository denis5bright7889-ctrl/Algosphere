import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/system/health
 *
 * Refocus R7: copy-engine queue and DLQ telemetry removed alongside
 * the deleted copy-engine. Now returns kill-switch state +
 * strategy-quarantine count only. Autotrade observability rebuilds on
 * PR #59B when that branch lands.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [ksRes, quarRes] = await Promise.all([
    supabase.from('global_risk_state')
      .select('kill_switch, reason, activated_by, activated_at')
      .eq('id', true).maybeSingle(),
    supabase.from('strategy_risk_state')
      .select('strategy_id', { head: true, count: 'exact' })
      .neq('status', 'active'),
  ])

  return NextResponse.json({
    kill_switch: {
      active:       Boolean(ksRes.data?.kill_switch),
      reason:       ksRes.data?.reason ?? null,
      activated_by: ksRes.data?.activated_by ?? null,
      activated_at: ksRes.data?.activated_at ?? null,
    },
    quarantined_strategies: quarRes.count ?? 0,
  })
}
