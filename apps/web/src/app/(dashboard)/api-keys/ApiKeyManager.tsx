'use client'

import { useEffect, useState } from 'react'
import { API_PERMISSIONS } from '@/lib/api-keys'
import { cn } from '@/lib/utils'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  permissions: string[]
  rate_limit_per_minute: number
  total_requests: number
  last_used_at: string | null
  revoked: boolean
  expires_at: string | null
  created_at: string
}

export default function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [perms, setPerms] = useState<string[]>(['signals:read'])
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/keys', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setKeys(body.keys ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, permissions: perms }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setSecret(body.secret)        // shown exactly once
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this key? Any integration using it will stop working immediately.')) return
    const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' })
    if (res.ok) load()
  }

  function togglePerm(p: string) {
    setPerms(cur => cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p])
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* One-time secret reveal */}
      {secret && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-5">
          <p className="text-sm font-bold text-amber-300">Copy your API key now</p>
          <p className="text-xs text-muted-foreground mt-1">
            This is the only time it will be shown. Store it securely.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-background px-3 py-2.5 text-xs font-mono">
              {secret}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(secret).catch(() => {})}
              className="btn-premium shrink-0 px-4 text-sm"
            >
              Copy
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSecret(null)}
            className="mt-3 text-xs text-muted-foreground hover:text-foreground"
          >
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={createKey} className="card-premium p-5 space-y-4">
        <h2 className="font-semibold tracking-tight">Create a new key</h2>
        <div className="space-y-1">
          <label htmlFor="key-name" className="text-xs text-muted-foreground">Label</label>
          <input
            id="key-name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            maxLength={60}
            placeholder="e.g. Production bot"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Permissions</span>
          <div className="flex flex-wrap gap-2">
            {API_PERMISSIONS.map(p => (
              <button
                type="button"
                key={p.key}
                onClick={() => togglePerm(p.key)}
                title={p.description}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-all touch-manipulation',
                  perms.includes(p.key)
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-border text-muted-foreground hover:border-amber-500/30',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || perms.length === 0}
          className={cn('btn-premium text-sm', (creating || perms.length === 0) && 'opacity-50 cursor-not-allowed')}
        >
          {creating ? 'Generating…' : 'Generate key'}
        </button>
      </form>

      {/* Existing keys */}
      <div className="card-premium p-5">
        <h2 className="font-semibold tracking-tight mb-4">Your keys</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet. Generate one above.</p>
        ) : (
          <ul className="space-y-3">
            {keys.map(k => (
              <li
                key={k.id}
                className={cn(
                  'rounded-xl border border-border bg-card p-4',
                  k.revoked && 'opacity-50',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm flex items-center gap-2">
                      {k.name}
                      {k.revoked && (
                        <span className="rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-bold uppercase">
                          Revoked
                        </span>
                      )}
                    </p>
                    <code className="text-xs text-muted-foreground font-mono">
                      {k.key_prefix}••••••••••••
                    </code>
                  </div>
                  {!k.revoked && (
                    <button
                      type="button"
                      onClick={() => revoke(k.id)}
                      className="rounded-md border border-destructive/40 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10 touch-manipulation"
                    >
                      Revoke
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Meta label="Requests" value={k.total_requests.toLocaleString()} />
                  <Meta label="Rate limit" value={`${k.rate_limit_per_minute}/min`} />
                  <Meta label="Last used" value={k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : '—'} />
                  <Meta label="Scopes" value={String(k.permissions?.length ?? 0)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Usage</p>
        <p>Base URL: <code className="text-amber-300">/api/v1</code></p>
        <p>Auth header: <code>Authorization: Bearer aq_live_…</code></p>
        <p>Example: <code>GET /api/v1/signals?limit=50&amp;pair=XAUUSD</code></p>
        <p>Rate limit is enforced per key per minute; exceeding it returns HTTP 429.</p>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums truncate">{value}</p>
    </div>
  )
}
