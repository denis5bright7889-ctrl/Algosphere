/**
 * Copy Trading Relay — Server-side orchestrator.
 *
 * Called whenever a leader (strategy creator) publishes a signal.
 * Fans out to all active subscribers based on their copy settings.
 *
 * Modes:
 *   - signal_only: send notification, no order
 *   - semi_auto:   create a copy_trade row in 'pending' (frontend prompts user to confirm)
 *   - full_auto:   VIP-only (requires connected broker — implemented in chain-engine)
 */

import { createServiceClient } from '@/lib/supabase/server'
import type { CopyMode } from '@/lib/strategies'
import { sendPushToUser } from '@/lib/notify/push'
import { sendEmail, signalAlertEmail } from '@/lib/notify/email'
import { recordShadowExecution } from '@/lib/shadow-log'

interface RelaySignal {
  id:              string
  pair:            string
  direction:       'buy' | 'sell'
  entry_price:     number
  stop_loss:       number
  take_profit_1:   number | null
  take_profit_2?:  number | null
  take_profit_3?:  number | null
  risk_reward:     number | null
  created_by:      string
  strategy_id?:    string | null
  tier_required?:  string
}

interface RelayResult {
  total_subscribers: number
  notified:          number
  pending_orders:    number
  full_auto:         number
  skipped:           number
  errors:            string[]
}

const PIP_VALUE_USD = 10  // conservative default — real adapters override per-pair

function pipSize(pair: string): number {
  if (pair.includes('JPY'))       return 0.01
  if (pair.startsWith('XAU'))     return 0.10
  if (pair.startsWith('XAG'))     return 0.01
  if (pair.startsWith('BTC'))     return 1.0
  if (pair.startsWith('ETH'))     return 0.10
  return 0.0001
}

function pipDistance(pair: string, fromPrice: number, toPrice: number): number {
  return Math.abs(fromPrice - toPrice) / pipSize(pair)
}

function scaleLot(args: {
  pair:            string
  stopLoss:        number
  entryPrice:      number
  followerEquity:  number
  allocationPct:   number
  riskMultiplier:  number
  maxLot:          number | null
}): number {
  const slPips    = pipDistance(args.pair, args.entryPrice, args.stopLoss)
  if (slPips <= 0) return 0
  const allocationUsd = args.followerEquity * (args.allocationPct / 100)
  const rawLot        = allocationUsd / (slPips * PIP_VALUE_USD)
  let scaled          = rawLot * args.riskMultiplier
  if (args.maxLot)    scaled = Math.min(scaled, args.maxLot)
  return Math.max(0.01, Math.round(scaled * 100) / 100)
}

/**
 * Main entry point. Call after a signal is published by a strategy creator.
 */
export async function relayLeaderSignal(signal: RelaySignal): Promise<RelayResult> {
  const supabase = createServiceClient()
  const result: RelayResult = {
    total_subscribers: 0,
    notified:          0,
    pending_orders:    0,
    full_auto:         0,
    skipped:           0,
    errors:            [],
  }

  // 1. Find active subscriptions for this leader's strategy (if any)
  const { data: subs, error } = await supabase
    .from('strategy_subscriptions')
    .select(`
      id, subscriber_id, strategy_id, copy_enabled, copy_mode,
      allocation_pct, risk_multiplier, max_lot_size, copy_sl, copy_tp,
      published_strategies!inner ( creator_id, status )
    `)
    .eq('copy_enabled', true)
    .eq('status', 'active')
    .eq('published_strategies.creator_id', signal.created_by)
    .eq('published_strategies.status', 'active')

  if (error) {
    result.errors.push(`Subscriber lookup failed: ${error.message}`)
    return result
  }
  if (!subs || subs.length === 0) return result

  result.total_subscribers = subs.length

  // 2. Fan out
  await Promise.all(
    subs.map(async sub => {
      try {
        await handleSubscriber(supabase, signal, sub, result)
      } catch (e) {
        result.errors.push(`Subscriber ${sub.subscriber_id}: ${String(e)}`)
        result.skipped += 1
      }
    })
  )

  return result
}

async function handleSubscriber(
  supabase: ReturnType<typeof createServiceClient>,
  signal:   RelaySignal,
  sub:      any,
  result:   RelayResult,
) {
  const mode: CopyMode = sub.copy_mode

  // SIGNAL_ONLY: send in-app notification + web push + email (best-effort, parallel)
  if (mode === 'signal_only') {
    await supabase.from('social_notifications').insert({
      recipient_id: sub.subscriber_id,
      actor_id:     signal.created_by,
      notif_type:   'signal_from_leader',
      entity_type:  'signal',
      entity_id:    signal.id,
      message:      `New ${signal.direction.toUpperCase()} signal on ${signal.pair}`,
    })

    // Fan out to channels respecting the follower's preferences. Non-blocking —
    // a channel failure must never prevent the relay from completing.
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('push_enabled, email_enabled')
      .eq('user_id', sub.subscriber_id)
      .maybeSingle()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algosphere.app'
    const dirIcon = signal.direction === 'buy' ? '🟢' : '🔴'
    const tasks: Promise<unknown>[] = []

    if (prefs?.push_enabled !== false) {
      tasks.push(sendPushToUser(sub.subscriber_id, {
        title: `${dirIcon} ${signal.pair} ${signal.direction.toUpperCase()}`,
        body:  `Entry ${signal.entry_price} · SL ${signal.stop_loss}${signal.take_profit_1 ? ` · TP ${signal.take_profit_1}` : ''}`,
        url:   `/dashboard/signals#${signal.id}`,
        tag:   `signal-${signal.id}`,
      }))
    }

    if (prefs?.email_enabled !== false) {
      // Need the follower's email — pull lazily, only if email channel is active
      tasks.push((async () => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', sub.subscriber_id)
          .single()
        if (!profile) return
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(sub.subscriber_id)
        if (!authUser?.email) return
        await sendEmail(signalAlertEmail({
          to:        authUser.email,
          pair:      signal.pair,
          direction: signal.direction,
          entry:     signal.entry_price,
          sl:        signal.stop_loss,
          tp:        signal.take_profit_1 ?? signal.entry_price,
          appUrl,
        }))
      })().catch(() => { /* logged in email lib */ }))
    }

    await Promise.allSettled(tasks)
    result.notified += 1
    return
  }

  // SEMI_AUTO + FULL_AUTO: estimate follower equity (paper-mode fallback)
  // In production, fetch from connected broker; for now use $10k baseline.
  const followerEquity = 10_000
  const scaledLot = scaleLot({
    pair:            signal.pair,
    stopLoss:        signal.stop_loss,
    entryPrice:      signal.entry_price,
    followerEquity,
    allocationPct:   sub.allocation_pct,
    riskMultiplier:  sub.risk_multiplier,
    maxLot:          sub.max_lot_size,
  })

  if (scaledLot < 0.01) {
    result.skipped += 1
    return
  }

  // Create copy_trade row (pending — updated post-execution for full_auto)
  const { data: ct } = await supabase
    .from('copy_trades')
    .insert({
      subscription_id: sub.id,
      leader_id:       signal.created_by,
      follower_id:     sub.subscriber_id,
      signal_id:       signal.id,
      symbol:          signal.pair,
      direction:       signal.direction,
      leader_entry:    signal.entry_price,
      follower_lot:    scaledLot,
      scale_factor:    scaledLot,
      stop_loss:       sub.copy_sl ? signal.stop_loss     : null,
      take_profit:     sub.copy_tp ? signal.take_profit_1 : null,
      copy_mode:       mode,
      status:          'pending',
    })
    .select('id')
    .single()

  // FULL_AUTO: hand off to the signal-engine's /execute endpoint.
  // Errors → mark the copy_trade as 'failed' but don't throw — relay keeps going.
  let executionStatus: 'mirrored' | 'pending' | 'failed' = 'pending'
  let executionNote = ''
  if (mode === 'full_auto' && ct?.id) {
    try {
      const exec = await executeOnBroker({
        symbol:          signal.pair,
        side:            signal.direction,
        quantity:        scaledLot,
        stop_loss:       sub.copy_sl ? signal.stop_loss     : undefined,
        take_profit:     sub.copy_tp ? signal.take_profit_1 ?? undefined : undefined,
        client_order_id: `copy_${ct.id.slice(0, 24)}`,
        user_id:         sub.subscriber_id,
      })
      if (exec.ok) {
        executionStatus = 'mirrored'
        executionNote   = `${exec.broker}${exec.testnet ? ' (testnet)' : ''} · ${exec.filled_qty} @ ${exec.avg_fill_price}`
        await supabase
          .from('copy_trades')
          .update({
            status:          'mirrored',
            broker:          exec.broker,
            broker_order_id: exec.order_id,
            follower_entry:  exec.avg_fill_price,
            slippage_pct:    exec.slippage_pct,
            opened_at:       new Date().toISOString(),
          })
          .eq('id', ct.id)

        // Shadow log — testnet fills count as a "shadow" record so we can
        // later compute drift vs leader once both close.
        await recordShadowExecution(supabase, {
          user_id:           sub.subscriber_id,
          signal_id:         signal.id,
          copy_trade_id:     ct.id,
          broker:            exec.broker,
          symbol:            signal.pair,
          direction:         signal.direction,
          intended_lot:      scaledLot,
          intended_entry:    signal.entry_price,
          intended_sl:       sub.copy_sl ? signal.stop_loss     : null,
          intended_tp:       sub.copy_tp ? signal.take_profit_1 : null,
          actual_status:     exec.testnet ? 'testnet' : 'mirrored',
          actual_fill_price: exec.avg_fill_price,
          actual_lot:        exec.filled_qty,
          slippage_pct:      exec.slippage_pct,
        })
      } else {
        executionStatus = 'failed'
        executionNote   = exec.error ?? 'broker rejection'
        await supabase
          .from('copy_trades')
          .update({ status: 'failed', skip_reason: executionNote })
          .eq('id', ct.id)
        await recordShadowExecution(supabase, {
          user_id:        sub.subscriber_id,
          signal_id:      signal.id,
          copy_trade_id:  ct.id,
          broker:         'binance',
          symbol:         signal.pair,
          direction:      signal.direction,
          intended_lot:   scaledLot,
          intended_entry: signal.entry_price,
          intended_sl:    sub.copy_sl ? signal.stop_loss     : null,
          intended_tp:    sub.copy_tp ? signal.take_profit_1 : null,
          actual_status:  'failed',
          skip_reason:    executionNote,
        })
      }
    } catch (err) {
      executionStatus = 'failed'
      executionNote   = err instanceof Error ? err.message : String(err)
      await supabase
        .from('copy_trades')
        .update({ status: 'failed', skip_reason: executionNote })
        .eq('id', ct.id)
        .then(() => {}, () => {})
    }
  }

  // Notification (message reflects execution outcome for full_auto)
  let msg: string
  if (mode === 'full_auto') {
    if (executionStatus === 'mirrored')
      msg = `Auto-executed ${signal.direction.toUpperCase()} ${signal.pair} @ ${scaledLot} (${executionNote})`
    else if (executionStatus === 'failed')
      msg = `Auto-execute failed for ${signal.pair}: ${executionNote}`
    else
      msg = `Auto-execute pending for ${signal.pair}`
  } else {
    msg = `Confirm copy trade: ${signal.direction.toUpperCase()} ${signal.pair} @ ${scaledLot} lots`
  }

  await supabase.from('social_notifications').insert({
    recipient_id: sub.subscriber_id,
    actor_id:     signal.created_by,
    notif_type:   mode === 'full_auto'
      ? (executionStatus === 'failed' ? 'copy_trade_failed' : 'copy_trade_opened')
      : 'copy_trade_ready',
    entity_type:  'signal',
    entity_id:    signal.id,
    message:      msg,
  })

  if (mode === 'full_auto') result.full_auto      += 1
  else                       result.pending_orders += 1
}

// ─── Engine bridge ─────────────────────────────────────────────────────

interface ExecuteRequest {
  symbol:          string
  side:            'buy' | 'sell'
  quantity:        number
  stop_loss?:      number | null
  take_profit?:    number | null
  client_order_id: string
  user_id:         string
}

interface ExecuteResponse {
  ok:              boolean
  order_id?:       string
  status?:         string
  filled_qty:      number
  avg_fill_price:  number
  slippage_pct:    number
  error?:          string
  broker:          string
  testnet:         boolean
}

/**
 * Call the signal-engine's /execute endpoint. Broker selection (binance/
 * bybit/okx/mt5/ctrader) is decided server-side based on the user's
 * connected broker — for v1 paper mode this is always Binance testnet.
 */
async function executeOnBroker(req: ExecuteRequest): Promise<ExecuteResponse> {
  const base = process.env.SIGNAL_ENGINE_URL
  const key  = process.env.ENGINE_API_KEY
  if (!base || !key) {
    return {
      ok: false,
      error: 'SIGNAL_ENGINE_URL / ENGINE_API_KEY not configured',
      filled_qty: 0, avg_fill_price: 0, slippage_pct: 0,
      broker: 'unknown', testnet: true,
    }
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/v1/execute`, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'X-Engine-Key':   key,
      },
      body: JSON.stringify({
        broker:           'binance',
        symbol:           req.symbol,
        side:             req.side,
        order_type:       'market',
        quantity:         req.quantity,
        stop_loss:        req.stop_loss ?? undefined,
        take_profit:      req.take_profit ?? undefined,
        client_order_id:  req.client_order_id,
        max_slippage_pct: 0.002,
        user_id:          req.user_id,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      return {
        ok: false, error: `engine ${res.status}: ${errBody.slice(0, 200)}`,
        filled_qty: 0, avg_fill_price: 0, slippage_pct: 0,
        broker: 'binance', testnet: true,
      }
    }
    return await res.json() as ExecuteResponse
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      filled_qty: 0, avg_fill_price: 0, slippage_pct: 0,
      broker: 'binance', testnet: true,
    }
  }
}
