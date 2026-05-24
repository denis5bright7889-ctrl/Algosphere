import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toPublicSignals } from '@/lib/signal-abstraction'

// Safe column set — strategy_id and quality_score are read only to derive
// the alias and band in toPublicSignal(); neither is serialized. Engine
// internals (feature_snapshot, component sub-scores, engine_version,
// admin_notes, created_by) are never selected.
const PUBLIC_COLUMNS =
  'id,pair,direction,entry_price,stop_loss,take_profit_1,take_profit_2,' +
  'take_profit_3,risk_reward,confidence_score,quality_score,regime,session,' +
  'strategy_id,status,lifecycle_state,result,pips_gained,tier_required,tags,' +
  'published_at,invalidated_at'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('signals')
    .select(PUBLIC_COLUMNS)
    .eq('status', 'active')
    .order('published_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Strategy-opacity boundary: never serialize raw rows.
  return NextResponse.json({ data: toPublicSignals(data) })
}
