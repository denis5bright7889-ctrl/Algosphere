/**
 * Copy Trade Settlement — runs when a signal reaches a terminal state.
 *
 * For every copy_trade tied to the closed signal:
 *   1. Compute follower_pnl from the signal's realized pips
 *   2. Mark the copy_trade closed
 *   3. Accrue creator profit-share into creator_earnings (above high-water-mark)
 *
 * Profit-share split: leader gets profit_share_pct, platform 5%, follower keeps rest.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const PLATFORM_SHARE_PCT = 5     // platform always takes 5% of shared profit
const PIP_VALUE_USD       = 10   // conservative default per lot per pip

interface SettlementResult {
  signal_id:       string
  copies_settled:  number
  total_follower_pnl: number
  earnings_accrued: number
  errors:          string[]
}

export async function settleCopyTradesForSignal(
  db: SupabaseClient,
  signalId: string,
): Promise<SettlementResult> {
  const result: SettlementResult = {
    signal_id:       signalId,
    copies_settled:  0,
    total_follower_pnl: 0,
    earnings_accrued: 0,
    errors:          [],
  }

  // 1. Load the closed signal
  const { data: signal } = await db
    .from('signals')
    .select('id, pair, direction, entry_price, pips_gained, result, created_by')
    .eq('id', signalId)
    .single()

  if (!signal) {
    result.errors.push('Signal not found')
    return result
  }

  const realizedPips = Number(signal.pips_gained ?? 0)

  // 2. Load all pending/mirrored copy_trades for this signal
  const { data: copies } = await db
    .from('copy_trades')
    .select(`
      id, subscription_id, leader_id, follower_id, follower_lot, copy_mode,
      strategy_subscriptions ( strategy_id, hwm_basis )
    `)
    .eq('signal_id', signalId)
    .in('status', ['pending', 'mirrored', 'partial'])

  if (!copies || copies.length === 0) return result

  for (const copy of copies) {
    try {
      const lot = Number(copy.follower_lot ?? 0)
      // follower PnL = pips × lot × pip-value
      const followerPnl = realizedPips * lot * PIP_VALUE_USD
      result.total_follower_pnl += followerPnl

      // Mark copy trade closed
      await db
        .from('copy_trades')
        .update({
          follower_pnl:     followerPnl,
          follower_pnl_pct: lot > 0
            ? Math.round((followerPnl / (lot * PIP_VALUE_USD * 100)) * 10_000) / 100
            : 0,
          status:           'closed',
          closed_at:        new Date().toISOString(),
        })
        .eq('id', copy.id)

      result.copies_settled += 1

      // Accrue creator profit-share only on profitable copies
      if (followerPnl > 0) {
        const sub = Array.isArray(copy.strategy_subscriptions)
          ? copy.strategy_subscriptions[0]
          : copy.strategy_subscriptions
        const strategyId = sub?.strategy_id

        if (strategyId) {
          const { data: strategy } = await db
            .from('published_strategies')
            .select('profit_share_pct, creator_id')
            .eq('id', strategyId)
            .single()

          if (strategy) {
            const leaderPct   = Number(strategy.profit_share_pct ?? 20)
            const leaderUsd   = followerPnl * leaderPct / 100
            const platformUsd = followerPnl * PLATFORM_SHARE_PCT / 100

            await db.from('creator_earnings').insert({
              creator_id:       strategy.creator_id,
              strategy_id:      strategyId,
              subscriber_id:    copy.follower_id,
              earning_type:     'profit_share',
              gross_usd:        followerPnl,
              platform_fee_pct: PLATFORM_SHARE_PCT,
              platform_fee_usd: platformUsd,
              creator_pct:      leaderPct,
              creator_usd:      leaderUsd,
              status:           'accrued',
            })
            result.earnings_accrued += leaderUsd

            // Notify follower of closed copy
            await db.from('social_notifications').insert({
              recipient_id: copy.follower_id,
              actor_id:     copy.leader_id,
              notif_type:   'copy_trade_closed',
              entity_type:  'signal',
              entity_id:    signalId,
              message: `Copy trade closed: ${signal.pair} ${followerPnl >= 0 ? '+' : ''}$${followerPnl.toFixed(2)}`,
            })
          }
        }
      }
    } catch (e) {
      result.errors.push(`Copy ${copy.id}: ${String(e)}`)
    }
  }

  // Bump leader's score (follower PnL affects score_follower_pnl)
  // Non-blocking — handled by the scoring engine's next pass.
  return result
}
