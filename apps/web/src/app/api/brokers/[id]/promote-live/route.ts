/**
 * Promote a broker connection from testnet → live.
 *
 * This is the ONLY path that can set is_testnet=false. It refuses
 * unless broker_execution_readiness() passes:
 *   50+ execs · ≥95% fill · <0.10% slip · 20+ closed · <2% drift
 *
 * On success it also tells the signal-engine to drop its cached
 * (testnet) adapter so the next order builds a fresh live one.
 *
 * There is deliberately no override flag — flipping to real money
 * without proven parity is the single most expensive mistake here.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Readiness {
  attempts:          number
  filled:            number
  fill_rate_pct:     number
  avg_abs_slip_pct:  number
  closed_count:      number
  avg_abs_drift_pct: number
  passes:            boolean
  reasons:           string[]
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership + current state
  const { data: conn } = await supabase
    .from('broker_connections')
    .select('id, broker, is_testnet, is_live')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (conn.is_testnet === false) {
    return NextResponse.json({ ok: true, already_live: true })
  }

  // Readiness gate (RPC is SECURITY DEFINER, scoped to this user_id)
  const { data: rows, error: rpcErr } = await supabase.rpc(
    'broker_execution_readiness',
    { p_user_id: user.id, p_broker: conn.broker },
  )
  if (rpcErr) {
    console.error('readiness rpc failed:', rpcErr)
    return NextResponse.json({ error: 'Readiness check failed' }, { status: 500 })
  }

  const readiness = (Array.isArray(rows) ? rows[0] : rows) as Readiness | undefined
  if (!readiness || !readiness.passes) {
    return NextResponse.json(
      {
        error:   'Not ready for live execution',
        gate:    'broker_execution_readiness',
        reasons: readiness?.reasons ?? ['no shadow execution history yet'],
        metrics: readiness ?? null,
      },
      { status: 403 },
    )
  }

  // Flip to live
  const svc = createServiceClient()
  const { data: updated, error } = await svc
    .from('broker_connections')
    .update({
      is_testnet: false,
      is_live:    true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, broker, is_testnet, is_live')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: 'Failed to promote' }, { status: 500 })
  }

  // Best-effort: invalidate the engine's cached testnet adapter
  const base = process.env.SIGNAL_ENGINE_URL
  const key  = process.env.ENGINE_API_KEY
  if (base && key) {
    fetch(
      `${base.replace(/\/$/, '')}/api/v1/execute/invalidate`
        + `?user_id=${encodeURIComponent(user.id)}&broker=${encodeURIComponent(conn.broker)}`,
      { method: 'POST', headers: { 'X-Engine-Key': key } },
    ).catch(() => { /* engine will rebuild lazily on next order anyway */ })
  }

  return NextResponse.json({
    ok:         true,
    connection: updated,
    metrics:    readiness,
  })
}
