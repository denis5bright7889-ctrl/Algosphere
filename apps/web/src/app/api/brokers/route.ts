import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { encrypt, isVaultAvailable, mask } from '@/lib/vault'

// GET — list my broker connections (secrets never returned in plaintext)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('broker_connections')
    .select(`
      id, broker, label, account_id, is_live, is_testnet, status,
      equity_usd, equity_updated_at, last_synced_at, error_message,
      is_default, created_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    connections: data ?? [],
    vault_ready: isVaultAvailable(),
  })
}

// For MT5 the three generic fields are repurposed (the engine uses the
// direct MetaTrader5 library — $0, no MetaApi cloud bridge):
//   api_key    → MT5 login (numeric account number)
//   api_secret → MT5 password
//   passphrase → broker server label, e.g. "Pepperstone-Demo"
const createSchema = z.object({
  broker:        z.enum(['binance','bybit','okx','mt5','ctrader']),
  label:         z.string().max(80).optional(),
  account_id:    z.string().max(60).optional(),
  api_key:       z.string().min(1).max(200),
  api_secret:    z.string().min(1).max(200),
  passphrase:    z.string().max(200).optional(),
  is_testnet:    z.boolean().default(true),
  is_default:    z.boolean().default(false),
})

// POST — register a new broker connection (encrypts on the server)
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isVaultAvailable()) {
    return NextResponse.json({
      error: 'CREDENTIAL_ENCRYPTION_KEY not configured on server',
      fix: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    }, { status: 503 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  // OKX needs a passphrase; reject if missing
  if (parsed.data.broker === 'okx' && !parsed.data.passphrase) {
    return NextResponse.json({ error: 'OKX requires a passphrase' }, { status: 422 })
  }
  // MT5: api_key must be the numeric login, passphrase must be the server
  if (parsed.data.broker === 'mt5') {
    if (!/^\d+$/.test(parsed.data.api_key)) {
      return NextResponse.json(
        { error: 'MT5 login must be the numeric account number' }, { status: 422 },
      )
    }
    if (!parsed.data.passphrase) {
      return NextResponse.json(
        { error: 'MT5 requires the broker server (e.g. "Pepperstone-Demo")' },
        { status: 422 },
      )
    }
  }

  const d = parsed.data
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('broker_connections')
    .insert({
      user_id:           user.id,
      broker:            d.broker,
      label:             d.label ?? null,
      account_id:        d.account_id ?? null,
      api_key_enc:       encrypt(d.api_key),
      api_secret_enc:    encrypt(d.api_secret),
      passphrase_enc:    d.passphrase ? encrypt(d.passphrase) : null,
      is_testnet:        d.is_testnet,
      is_live:           !d.is_testnet,
      is_default:        d.is_default,
      status:            'pending',
    })
    .select('id, broker, label, is_testnet, is_default, status, created_at')
    .single()

  if (error) {
    // Friendly duplicate handler
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'You already have a connection for that broker + account_id pair' },
        { status: 409 },
      )
    }
    console.error('broker create error:', error)
    return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 })
  }

  return NextResponse.json({
    connection: data,
    masked_key: mask(d.api_key),
  }, { status: 201 })
}
