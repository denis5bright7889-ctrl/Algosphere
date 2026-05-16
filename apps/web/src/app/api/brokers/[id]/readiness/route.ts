/**
 * Read-only live-readiness snapshot for one broker connection.
 * Powers the "Go Live" gauge on the /brokers card. Same RPC the
 * promote-live endpoint enforces — this just surfaces it.
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: conn } = await supabase
    .from('broker_connections')
    .select('broker, is_testnet')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: rows, error } = await supabase.rpc(
    'broker_execution_readiness',
    { p_user_id: user.id, p_broker: conn.broker },
  )
  if (error) {
    return NextResponse.json({ error: 'Readiness check failed' }, { status: 500 })
  }

  const r = Array.isArray(rows) ? rows[0] : rows
  return NextResponse.json({ is_testnet: conn.is_testnet, readiness: r ?? null })
}
