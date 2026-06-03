import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { executeManualOrder } from '@/lib/engine-client'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'

/**
 * POST /api/trade/execute — place ONE order from a signal the user is
 * looking at. Manual, one-click-with-confirmation execution.
 *
 * Trust boundary: this route never touches a broker. It authenticates
 * the user, re-validates the signal and broker ownership server-side
 * (never trusting client-sent prices), then hands a clean request to the
 * engine via executeManualOrder(). The engine owns credential decryption
 * and the risk firewall; we relay its verdict.
 *
 * Fail-closed: any missing precondition returns an error and no order is
 * attempted. We only report success when the engine confirms it.
 */
const bodySchema = z.object({
  signalId:           z.string().uuid(),
  brokerConnectionId: z.string().uuid(),
  size:               z.number().positive().max(1_000_000),
  // Live (real-money) brokers require an explicit extra confirmation flag,
  // so a misclick on a testnet card can never route to a live account.
  confirmLive:        z.boolean().optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.flatten() },
      { status: 422 },
    )
  }
  const { signalId, brokerConnectionId, size, confirmLive } = parsed.data

  // Re-read the signal server-side — the client never gets to dictate the
  // pair/direction/levels we trade. Public-read by RLS.
  const { data: signal } = await supabase
    .from('signals')
    .select('id, pair, direction, entry_price, stop_loss, take_profit_1, status, lifecycle_state')
    .eq('id', signalId)
    .single()

  if (!signal) {
    return NextResponse.json({ error: 'Signal not found' }, { status: 404 })
  }
  const isActive = signal.status === 'active' || signal.lifecycle_state === 'active'
  if (!isActive) {
    return NextResponse.json(
      { error: 'This signal is no longer active and cannot be traded.' },
      { status: 409 },
    )
  }
  if (signal.direction !== 'buy' && signal.direction !== 'sell') {
    return NextResponse.json({ error: 'Signal has no tradable direction.' }, { status: 422 })
  }

  // Ownership check on the broker connection (defense in depth over RLS).
  const { data: broker } = await supabase
    .from('broker_connections')
    .select('id, broker, status, is_live, is_testnet, user_id')
    .eq('id', brokerConnectionId)
    .single()

  if (!broker || broker.user_id !== user.id) {
    return NextResponse.json({ error: 'Broker connection not found' }, { status: 404 })
  }
  if (broker.status !== 'connected') {
    return NextResponse.json(
      { error: 'That broker is not connected. Reconnect it on the Brokers page before trading.' },
      { status: 409 },
    )
  }
  if (broker.is_live && confirmLive !== true) {
    return NextResponse.json(
      { error: 'This is a LIVE (real-money) account. Re-confirm to place a live order.', requiresLiveConfirm: true },
      { status: 428 },
    )
  }

  const exec = await executeManualOrder({
    user_id:         user.id,
    broker:          broker.broker,
    symbol:          signal.pair,
    side:            signal.direction,
    quantity:        size,
    stop_loss:       signal.stop_loss ?? null,
    take_profit:     signal.take_profit_1 ?? null,
    // Idempotency: one fill per (signal, broker) submission. The engine
    // dedupes a double-submit on this key instead of double-filling.
    client_order_id: `${signal.id}:${broker.id}`,
  })

  // Transport failure (engine unreachable / not configured / bad key / 422).
  if (!exec.ok) {
    return NextResponse.json({ error: exec.error }, { status: 502 })
  }

  // Engine reached. ExecuteOut.ok=false means the order was refused by a
  // gate (kill switch, risk, slippage veto, broker reject) — surface that
  // as a normalized "rejected" outcome the card can render, not an error.
  const out = exec.data
  if (!out.ok) {
    // Discord trades channel — log the rejection so operators see it
    // in real time. Fire-and-forget; never block the API response.
    notify.trade(
      `🟥 **REJECTED** · ${signal.pair} ${signal.direction.toUpperCase()} ${size}`,
      {
        embed: {
          title:       `${signal.pair} ${signal.direction.toUpperCase()} — rejected`,
          description: out.error ?? 'Order rejected by the risk engine.',
          color:       EMBED_COLOR.critical,
          fields: [
            { name: 'Broker', value: `${broker.broker}${broker.is_live ? ' (LIVE)' : ' (testnet)'}`, inline: true },
            { name: 'Size',   value: String(size),                                                   inline: true },
            { name: 'Entry',  value: String(signal.entry_price ?? '—'),                              inline: true },
            { name: 'User',   value: user.email ?? user.id,                                          inline: false },
          ],
          timestamp: new Date().toISOString(),
        },
      },
    ).catch(() => { /* swallow — trade-channel ping is best-effort */ })

    return NextResponse.json({
      result: {
        status:          'rejected',
        broker_order_id: null,
        filled_price:    null,
        reason:          out.error ?? 'Order rejected by the risk engine.',
      },
    })
  }

  const filled = out.filled_qty > 0
  // Discord trades channel — log the placement. Fire-and-forget.
  notify.trade(
    `${filled ? '🟢 **FILLED**' : '🔵 **SUBMITTED**'} · ${signal.pair} ${signal.direction.toUpperCase()} ${size}`,
    {
      embed: {
        title:       `${signal.pair} ${signal.direction.toUpperCase()} — ${filled ? 'filled' : 'submitted'}`,
        color:       filled ? EMBED_COLOR.ok : EMBED_COLOR.info,
        fields: [
          { name: 'Broker',     value: `${broker.broker}${broker.is_live ? ' (LIVE)' : ' (testnet)'}`, inline: true },
          { name: 'Size',       value: String(size),                                                   inline: true },
          { name: 'Fill price', value: String(out.avg_fill_price || '—'),                              inline: true },
          { name: 'Order ref',  value: out.order_id ?? '—',                                            inline: false },
          { name: 'User',       value: user.email ?? user.id,                                          inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    },
  ).catch(() => {})

  return NextResponse.json({
    result: {
      status:          filled ? 'filled' : 'submitted',
      broker_order_id: out.order_id,
      filled_price:    out.avg_fill_price || null,
      reason:          null,
    },
  })
}
