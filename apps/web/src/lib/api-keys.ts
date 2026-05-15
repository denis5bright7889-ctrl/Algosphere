import { createHash, randomBytes } from 'crypto'

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `aq_live_${randomBytes(24).toString('hex')}`
  const prefix = raw.slice(0, 12)
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, prefix, hash }
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export const API_PERMISSIONS = [
  { key: 'signals:read', label: 'Read signals', description: 'Access active and historical signals' },
  { key: 'journal:read', label: 'Read journal', description: 'Read trade journal entries' },
  { key: 'journal:write', label: 'Write journal', description: 'Create and update journal entries' },
  { key: 'analytics:read', label: 'Read analytics', description: 'Access performance metrics' },
] as const

export type ApiPermission = typeof API_PERMISSIONS[number]['key']
