/**
 * AlgoSphere Quant — Credential vault (AES-256-GCM).
 *
 * Used to encrypt broker API keys before storing in `broker_connections`.
 * Key material: CREDENTIAL_ENCRYPTION_KEY (32-byte base64 in env).
 *
 * Generate the key once with:
 *   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
 *
 * Format on disk:  base64(IV[12]) + ':' + base64(authTag[16]) + ':' + base64(ciphertext)
 *
 * Server-only. Never import from a Client Component.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

class VaultError extends Error {
  constructor(msg: string, public code: 'no_key' | 'malformed' | 'auth_failed') {
    super(msg); this.name = 'VaultError'
  }
}

function getKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!raw) throw new VaultError('CREDENTIAL_ENCRYPTION_KEY not configured', 'no_key')
  const key = Buffer.from(raw, 'base64')
  if (key.byteLength !== 32) {
    throw new VaultError(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got ${key.byteLength})`,
      'no_key',
    )
  }
  return key
}

export function isVaultAvailable(): boolean {
  try { getKey(); return true } catch { return false }
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const key = getKey()
  const iv  = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':')
}

export function decrypt(blob: string): string {
  if (!blob) return ''
  const parts = blob.split(':')
  if (parts.length !== 3) throw new VaultError('Malformed vault blob', 'malformed')
  const [ivB64, tagB64, ctB64] = parts as [string, string, string]
  const key = getKey()
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new VaultError('Decryption failed — wrong key or tampered ciphertext', 'auth_failed')
  }
}

/** Show only the last 4 chars in UI lists. Safe for display. */
export function mask(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '••••'
  return `••••${secret.slice(-4)}`
}
