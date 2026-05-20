import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { testBrokerConnection } from '@/lib/engine-client'

/**
 * POST /api/brokers/paper — create a paper-trading connection.
 *
 * No API keys required. Inserts a broker_connections row with
 * broker='paper' (the migration drops NOT NULL on the cred columns
 * and allows 'paper' in the broker CHECK) then immediately calls
 * the engine's /api/v1/brokers/test endpoint to materialise the
 * paper_state row + flip status to 'connected'.
 *
 * Idempotent: a second call returns the existing row instead of
 * creating a duplicate (broker_connections UNIQUE (user_id, broker,
 * account_id) catches it, and we surface the existing row).
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // If the user already has a paper connection, return it.
  const { data: existing } = await supabase
    .from('broker_connections')
    .select('id, broker, label, is_testnet, is_default, status, error_message, equity_usd, equity_updated_at, created_at')
    .eq('user_id', user.id)
    .eq('broker',  'paper')
    .maybeSingle()

  if (existing) {
    // Re-trigger the handshake so the equity refreshes inline.
    await testBrokerConnection(user.id, 'paper')
    const { data: refreshed } = await supabase
      .from('broker_connections')
      .select('id, broker, label, is_testnet, is_default, status, error_message, equity_usd, equity_updated_at, created_at')
      .eq('id', existing.id)
      .single()
    return NextResponse.json({ connection: refreshed ?? existing }, { status: 200 })
  }

  // Insert a fresh paper row via service role so the cred columns
  // (now NULL-able post-migration) accept empty strings — RLS allows
  // the user to do this themselves too, but service-role is simpler.
  const svc = createServiceClient()
  const { data: inserted, error } = await svc
    .from('broker_connections')
    .insert({
      user_id:        user.id,
      broker:         'paper',
      label:          'Paper trading',
      account_id:     null,
      api_key_enc:    '',
      api_secret_enc: '',
      passphrase_enc: null,
      is_testnet:     true,
      is_live:        false,
      is_default:     false,
      status:         'pending',
    })
    .select('id, broker, label, is_testnet, is_default, status, error_message, equity_usd, equity_updated_at, created_at')
    .single()

  if (error) {
    console.error('paper connection create error:', error)
    return NextResponse.json(
      { error: 'Failed to create paper connection' },
      { status: 500 },
    )
  }

  // Immediately ask the engine to materialise the paper_state row +
  // flip status to connected. If the engine is unreachable the row
  // stays as 'pending' and the periodic probe picks it up.
  const verdict = await testBrokerConnection(user.id, 'paper')
  let resolved = inserted
  if (verdict.ok) {
    const { data: fresh } = await svc
      .from('broker_connections')
      .select('id, broker, label, is_testnet, is_default, status, error_message, equity_usd, equity_updated_at, created_at')
      .eq('id', inserted.id)
      .single()
    if (fresh) resolved = fresh
  }

  return NextResponse.json({
    connection:   resolved,
    handshake:    verdict.ok ? verdict.data : null,
    engine_error: verdict.ok ? null : verdict.error,
  }, { status: 201 })
}
