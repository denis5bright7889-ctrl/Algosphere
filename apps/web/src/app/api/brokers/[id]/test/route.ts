import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testBrokerConnection } from '@/lib/engine-client'

/**
 * POST /api/brokers/[id]/test — re-run the engine handshake for an
 * existing connection. Owned by the user (RLS on broker_connections
 * + ownership check below). Returns the same shape as the engine's
 * /api/v1/brokers/test plus the refreshed row so the UI can re-render
 * inline without a full reload.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: conn } = await supabase
    .from('broker_connections')
    .select('id, broker, user_id')
    .eq('id', id)
    .single()

  if (!conn || conn.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const verdict = await testBrokerConnection(user.id, conn.broker)
  if (!verdict.ok) {
    return NextResponse.json(
      { error: `engine unreachable: ${verdict.error}` },
      { status: 503 },
    )
  }

  // Engine has already persisted the verdict; read the refreshed row.
  const { data: fresh } = await supabase
    .from('broker_connections')
    .select(`
      id, broker, label, account_id, is_live, is_testnet, status,
      equity_usd, equity_updated_at, last_synced_at, error_message,
      is_default, created_at
    `)
    .eq('id', id)
    .single()

  return NextResponse.json({
    handshake:  verdict.data,
    connection: fresh,
  })
}
