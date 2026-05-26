/**
 * Deterministic, NON-secret fingerprint for a real-world broker account.
 *
 *   fingerprint = sha256(broker + ':' + normalized_public_identity)
 *
 * The fingerprint is one-way and never contains the password / api_secret.
 * Two different AlgoSphere users supplying the SAME real broker account
 * produce the SAME fingerprint, which is what lets the database enforce
 * one-account-per-user via UNIQUE(broker_account_ownership.fingerprint).
 *
 * Identity per broker (the field(s) that uniquely identify a real account
 * at that broker — credentials needed to AUTHENTICATE are deliberately
 * excluded):
 *   mt5        → server (lowercased + trimmed) + login (digits)
 *   binance    → api_key (full key; Binance keys are account-scoped)
 *   bybit      → api_key
 *   okx        → api_key
 *   ctrader    → api_key
 *   oanda      → account_id
 *   tradovate  → account_id (username)
 *
 * Returns null when the supplied input doesn't carry enough identity to
 * fingerprint — callers MUST treat null as "no enforcement possible" and
 * either reject the request or skip the gate explicitly.
 */
import { createHash } from 'crypto'

export type FingerprintBroker =
  'binance' | 'bybit' | 'okx' | 'mt5' | 'ctrader' | 'oanda' | 'tradovate'

export interface BrokerIdentityInput {
  broker:      FingerprintBroker
  api_key?:    string   // MT5: numeric login
  account_id?: string
  passphrase?: string   // MT5: broker server label, e.g. "Pepperstone-Demo"
}

export function brokerFingerprint(input: BrokerIdentityInput): string | null {
  const identity = extractIdentity(input)
  if (!identity) return null
  return createHash('sha256').update(`${input.broker}:${identity}`).digest('hex')
}

function extractIdentity(input: BrokerIdentityInput): string | null {
  switch (input.broker) {
    case 'mt5': {
      const login  = input.api_key?.trim()
      const server = input.passphrase?.trim().toLowerCase()
      if (!login || !server) return null
      return `${server}|${login}`
    }
    case 'binance':
    case 'bybit':
    case 'okx':
    case 'ctrader': {
      const k = input.api_key?.trim()
      return k || null
    }
    case 'oanda':
    case 'tradovate': {
      const id = input.account_id?.trim()
      return id || null
    }
  }
}
