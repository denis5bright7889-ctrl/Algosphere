/**
 * Shadow Execution Log — record every full_auto signal that the relay
 * *intended* to fire, regardless of whether the broker actually filled it.
 *
 * Used to validate execution quality (slippage, fill rate, PnL drift vs
 * leader) before flipping a user's broker from testnet → live.
 *
 * Call sites:
 *   - copy-relay.ts on every full_auto attempt → record intent + outcome
 *   - copy-settlement.ts on signal close → patch leader_pnl + follower_pnl + drift
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecordIntent {
  user_id:        string
  signal_id:      string | null
  copy_trade_id:  string | null
  broker:         string
  symbol:         string
  direction:      'buy' | 'sell'
  intended_lot:   number
  intended_entry: number | null
  intended_sl:    number | null
  intended_tp:    number | null
  actual_status:  'mirrored' | 'failed' | 'skipped' | 'testnet' | 'shadow_only'
  actual_fill_price?: number | null
  actual_lot?:    number | null
  slippage_pct?:  number | null
  skip_reason?:   string | null
}

export async function recordShadowExecution(
  db: SupabaseClient,
  r: RecordIntent,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('shadow_executions')
      .insert({
        user_id:           r.user_id,
        signal_id:         r.signal_id,
        copy_trade_id:     r.copy_trade_id,
        broker:            r.broker,
        symbol:            r.symbol,
        direction:         r.direction,
        intended_lot:      r.intended_lot,
        intended_entry:    r.intended_entry,
        intended_sl:       r.intended_sl,
        intended_tp:       r.intended_tp,
        actual_status:     r.actual_status,
        actual_fill_price: r.actual_fill_price ?? null,
        actual_lot:        r.actual_lot ?? null,
        slippage_pct:      r.slippage_pct ?? null,
        skip_reason:       r.skip_reason ?? null,
      })
      .select('id')
      .single()
    if (error) {
      console.error('shadow log insert failed:', error)
      return null
    }
    return data.id
  } catch (e) {
    console.error('shadow log unexpected:', e)
    return null
  }
}

/**
 * Close out an open shadow execution with PnL drift. Called from
 * copy-settlement.ts when the matching signal hits TP/SL.
 */
export async function closeShadowExecution(
  db: SupabaseClient,
  args: {
    copy_trade_id: string
    leader_pnl:    number
    follower_pnl:  number
  },
): Promise<void> {
  const drift = args.leader_pnl !== 0
    ? Math.round(((args.leader_pnl - args.follower_pnl) / Math.abs(args.leader_pnl)) * 10_000) / 100
    : 0
  await db
    .from('shadow_executions')
    .update({
      leader_pnl:    args.leader_pnl,
      follower_pnl:  args.follower_pnl,
      pnl_drift_pct: drift,
      closed_at:     new Date().toISOString(),
    })
    .eq('copy_trade_id', args.copy_trade_id)
    .is('closed_at', null)
}
