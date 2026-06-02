import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { encrypt, isVaultAvailable, mask } from '@/lib/vault'
import { testBrokerConnection } from '@/lib/engine-client'
import { brokerFingerprint } from '@/lib/broker-fingerprint'
import { trackServerAsync } from '@/lib/tracking/server'

/**
 * Persist a blocked claim into the broker_contention state table (current
 * state) alongside the immutable reclaim_blocked history (audit). Best-
 * effort, read-then-write: a blocked connect is rare so the non-atomic
 * increment is fine. Status is never downgraded here — an admin's
 * resolved/dismissed decision is preserved even if the contender retries.
 */
async function recordContention(
  svc: ReturnType<typeof createServiceClient>,
  fingerprint: string, contenderId: string, ip: string | null, ua: string | null,
): Promise<void> {
  try {
    const { data: ex } = await svc
      .from('broker_contention')
      .select('id, attempt_count')
      .eq('fingerprint', fingerprint).eq('contender_user_id', contenderId)
      .maybeSingle()
    if (ex) {
      const row = ex as { id: string; attempt_count: number }
      await svc.from('broker_contention').update({
        attempt_count:   (row.attempt_count ?? 1) + 1,
        last_attempt_at: new Date().toISOString(),
        last_ip: ip, last_user_agent: ua,
      }).eq('id', row.id)
    } else {
      await svc.from('broker_contention').insert({
        fingerprint, contender_user_id: contenderId, status: 'active_contention',
        attempt_count: 1, last_ip: ip, last_user_agent: ua,
      })
    }
  } catch { /* contention state is best-effort; never blocks a connect */ }
}

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
  broker:        z.enum(['binance','bybit','okx','mt5','ctrader','oanda','tradovate']),
  label:         z.string().max(80).optional(),
  account_id:    z.string().max(60).optional(),
  // api_key / api_secret are optional at the schema level because not
  // every broker needs both (OANDA = token + account; Tradovate =
  // username + password). Per-broker required-field checks run below.
  api_key:       z.string().max(200).optional().default(''),
  api_secret:    z.string().max(200).optional().default(''),
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

  // Per-broker required-field validation.
  const pd = parsed.data
  if ((pd.broker === 'binance' || pd.broker === 'bybit' || pd.broker === 'okx' || pd.broker === 'ctrader')
      && (!pd.api_key || !pd.api_secret)) {
    return NextResponse.json({ error: `${pd.broker} requires API key + secret` }, { status: 422 })
  }
  if (pd.broker === 'okx' && !pd.passphrase) {
    return NextResponse.json({ error: 'OKX requires a passphrase' }, { status: 422 })
  }
  if (pd.broker === 'mt5') {
    if (!/^\d+$/.test(pd.api_key)) {
      return NextResponse.json(
        { error: 'MT5 login must be the numeric account number' }, { status: 422 },
      )
    }
    if (!pd.passphrase) {
      return NextResponse.json(
        { error: 'MT5 requires the broker server (e.g. "Pepperstone-Demo")' },
        { status: 422 },
      )
    }
  }
  if (pd.broker === 'oanda' && (!pd.api_key || !pd.account_id)) {
    return NextResponse.json(
      { error: 'OANDA requires an API token + account ID' }, { status: 422 },
    )
  }
  if (pd.broker === 'tradovate' && (!pd.account_id || !pd.api_secret)) {
    return NextResponse.json(
      { error: 'Tradovate requires a username (account ID) + password' }, { status: 422 },
    )
  }

  const d = parsed.data
  const svc = createServiceClient()

  // ── Anti-sharing gate (institutional broker-ownership registry) ──────
  // Deterministic non-secret fingerprint of the real-world broker account
  // (sha256 of broker + public identity tuple; never includes the
  // password/api_secret). Same real account → same fingerprint regardless
  // of which AlgoSphere user is connecting. DB enforces uniqueness via
  // broker_account_ownership.fingerprint; we check first so we can return
  // the user-facing message instead of a raw 23505. Server-only — never
  // trust the frontend for this.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent') ?? null
  const fingerprint = brokerFingerprint({
    broker:     d.broker,
    api_key:    d.api_key,
    account_id: d.account_id ?? undefined,
    passphrase: d.passphrase ?? undefined,
  })
  // ── Ownership-policy gate (single_owner default / shared / revoked) ──
  // single_owner: exactly one owner; a DIFFERENT user is always blocked —
  // ownership transitions only through the admin transfer/revoke endpoints
  // (no auto-claim, even after an unlink cooldown). shared: explicit admin
  // opt-in — a different user may connect as a co-user WITHOUT taking
  // ownership. revoked: blocked at the gate; admin reassigns explicitly.
  let sharedCoUser = false
  if (fingerprint) {
    const { data: existing } = await svc
      .from('broker_account_ownership')
      .select('owner_user_id, ownership_status, ownership_mode, shared_enabled')
      .eq('fingerprint', fingerprint)
      .maybeSingle()

    if (existing) {
      const e = existing as {
        owner_user_id: string; ownership_status: string
        ownership_mode: string; shared_enabled: boolean
      }
      const sameUser      = e.owner_user_id === user.id
      const sharedAllowed = e.shared_enabled || e.ownership_mode === 'shared'

      // Same user always reconnects. Different user only when shared.
      if (!sameUser) {
        if (sharedAllowed) {
          // SHARED_MODE — allowed as a co-user; ownership is NOT transferred.
          sharedCoUser = true
          svc.from('broker_ownership_history').insert({
            fingerprint, broker: d.broker,
            previous_owner_user_id: e.owner_user_id,
            new_owner_user_id:      user.id,
            action: 'linked', reason: 'shared_mode_co_user',
            actor_id: user.id, ip_address: ip, user_agent: ua,
          }).then(() => {}, () => {})
        } else {
          // single_owner / revoked — strict block + contention.
          const reason = e.ownership_mode === 'revoked'   ? 'ownership revoked — admin reassignment required'
                       : e.ownership_status === 'cooldown' ? 'fingerprint in unlink cooldown'
                       : 'fingerprint owned by different user'
          svc.from('broker_ownership_history').insert({
            fingerprint, broker: d.broker,
            previous_owner_user_id: e.owner_user_id,
            new_owner_user_id:      user.id,
            action: 'reclaim_blocked', reason,
            actor_id: user.id, ip_address: ip, user_agent: ua,
          }).then(() => {}, () => {})
          void recordContention(svc, fingerprint, user.id, ip, ua)
          return NextResponse.json(
            { error: 'This trading account is already connected to another AlgoSphere profile.',
              code: 'BROKER_ALREADY_OWNED' },
            { status: 409 },
          )
        }
      }
    }
  }

  const { data, error } = await svc
    .from('broker_connections')
    .insert({
      user_id:           user.id,
      broker:            d.broker,
      label:             d.label ?? null,
      account_id:        d.account_id ?? null,
      // Columns are nullable post-migration; only encrypt non-empty creds.
      api_key_enc:       d.api_key    ? encrypt(d.api_key)    : '',
      api_secret_enc:    d.api_secret ? encrypt(d.api_secret) : '',
      passphrase_enc:    d.passphrase ? encrypt(d.passphrase) : null,
      is_testnet:        d.is_testnet,
      is_live:           !d.is_testnet,
      is_default:        d.is_default,
      status:            'pending',
      // Denormalized fingerprint for join-free lookups (NULL until migration 041).
      broker_account_fingerprint: fingerprint,
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

  // Funnel: broker_connected — fire-and-forget. Idempotent at the
  // dashboard layer (distinct user_id collapses repeats).
  trackServerAsync({
    event:       'broker_connected',
    userId:      user.id,
    source_kind: 'app',
    payload:     { broker: d.broker, label: d.label ?? null, is_testnet: d.is_testnet },
  })

  // Register/refresh ownership for this fingerprint (idempotent upsert).
  // Skipped for a shared-mode co-user: they get a broker_connections row
  // but must NOT overwrite the existing owner. Best-effort.
  if (fingerprint && !sharedCoUser) {
    svc.from('broker_account_ownership').upsert({
      fingerprint, broker: d.broker, owner_user_id: user.id,
      current_connection_id: data.id,
      last_seen_at: new Date().toISOString(),
      last_seen_ip: ip,
      ownership_status: 'active',
    }, { onConflict: 'fingerprint' }).then(() => {}, () => {})
    svc.from('broker_ownership_history').insert({
      fingerprint, broker: d.broker,
      new_owner_user_id: user.id,
      action: 'linked',
      actor_id: user.id, ip_address: ip, user_agent: ua,
    }).then(() => {}, () => {})
  }

  // Immediately handshake against the engine so the user gets a verdict
  // in the same response — no 10-minute pending limbo. If the engine is
  // unreachable, we leave the row as 'pending' and let the periodic
  // probe pick it up; the UI explains that explicitly.
  let resolved = data
  const verdict = await testBrokerConnection(user.id, d.broker)
  if (verdict.ok) {
    // The engine already persisted status + error_message; refetch so
    // the client sees the resolved state in this single round-trip.
    const { data: fresh } = await svc
      .from('broker_connections')
      .select('id, broker, label, is_testnet, is_default, status, error_message, equity_usd, equity_updated_at, created_at')
      .eq('id', data.id)
      .single()
    if (fresh) resolved = fresh
  }

  return NextResponse.json({
    connection:    resolved,
    masked_key:    mask(d.api_key),
    handshake:     verdict.ok ? verdict.data : null,
    engine_error:  verdict.ok ? null : verdict.error,
  }, { status: 201 })
}
