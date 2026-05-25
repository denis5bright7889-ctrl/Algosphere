/**
 * One-off (idempotent) backfill of the broker-ownership registry.
 *
 * For every broker_connections row that still lacks a fingerprint
 * (pre-migration-041 data), decrypt the stored credentials, compute the
 * deterministic non-secret fingerprint with the same helper the live
 * connect path uses, and upsert the corresponding broker_account_ownership
 * row. Idempotent: safe to re-run.
 *
 * Required env (mirrors the web app):
 *   SUPABASE_URL                  (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CREDENTIAL_ENCRYPTION_KEY     (the vault key — must match what wrote the rows)
 *
 *   npx tsx apps/web/scripts/backfill-broker-fingerprints.ts
 */
import { createClient } from '@supabase/supabase-js'
import { decrypt, isVaultAvailable } from '../src/lib/vault'
import { brokerFingerprint, type FingerprintBroker } from '../src/lib/broker-fingerprint'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}
if (!isVaultAvailable()) {
  console.error('missing CREDENTIAL_ENCRYPTION_KEY (lib/vault refuses to decrypt without it)')
  process.exit(2)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY)

interface Row {
  id:              string
  user_id:         string
  broker:          string
  account_id:      string | null
  api_key_enc:     string | null
  passphrase_enc:  string | null
}

async function main(): Promise<void> {
  const { data: rows, error } = await db
    .from('broker_connections')
    .select('id, user_id, broker, account_id, api_key_enc, passphrase_enc')
    .is('broker_account_fingerprint', null)
    .limit(1000)
  if (error) throw error
  const list = (rows ?? []) as Row[]
  console.log(`found ${list.length} broker_connections row(s) without a fingerprint`)

  let fingerprinted = 0, skipped = 0, collisions = 0
  for (const r of list) {
    const broker = r.broker as FingerprintBroker
    let api_key:    string | undefined
    let passphrase: string | undefined
    try {
      api_key    = r.api_key_enc    ? decrypt(r.api_key_enc)    : undefined
      passphrase = r.passphrase_enc ? decrypt(r.passphrase_enc) : undefined
    } catch (e) {
      console.warn(`[${r.id}] decrypt failed (${(e as Error).message}) — skipped`)
      skipped++; continue
    }

    const fp = brokerFingerprint({
      broker, api_key, account_id: r.account_id ?? undefined, passphrase,
    })
    if (!fp) {
      console.warn(`[${r.id}] ${broker}: insufficient identity to fingerprint — skipped`)
      skipped++; continue
    }

    // Refuse to claim a fingerprint already owned by a different user.
    const { data: existing } = await db
      .from('broker_account_ownership')
      .select('owner_user_id')
      .eq('fingerprint', fp)
      .maybeSingle()
    const ex = existing as { owner_user_id: string } | null
    if (ex && ex.owner_user_id !== r.user_id) {
      console.warn(`[${r.id}] ${broker}: fingerprint already owned by ${ex.owner_user_id.slice(0,8)} — left unset (manual review)`)
      collisions++; continue
    }

    // Upsert ownership, denormalize fingerprint, append history.
    await db.from('broker_account_ownership').upsert({
      fingerprint:           fp,
      broker,
      owner_user_id:         r.user_id,
      current_connection_id: r.id,
      last_seen_at:          new Date().toISOString(),
      ownership_status:      'active',
    }, { onConflict: 'fingerprint' })
    await db.from('broker_connections').update({ broker_account_fingerprint: fp }).eq('id', r.id)
    await db.from('broker_ownership_history').insert({
      fingerprint: fp, broker,
      new_owner_user_id: r.user_id,
      action: 'linked', reason: 'backfill',
    })
    console.log(`[${r.id}] ${broker} → ${fp.slice(0, 12)}…  ✓`)
    fingerprinted++
  }
  console.log(`\ndone — fingerprinted=${fingerprinted} skipped=${skipped} collisions=${collisions}`)
}

main().catch(e => { console.error(e); process.exit(1) })
