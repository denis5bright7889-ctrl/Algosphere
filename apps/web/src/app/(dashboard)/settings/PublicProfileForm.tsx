'use client'

import { useState } from 'react'
import { normalizeHandle, isValidHandle } from '@/lib/leaderboard'
import { cn } from '@/lib/utils'

interface Props {
  initialEnabled: boolean
  initialHandle: string
  initialBio: string
}

export default function PublicProfileForm({ initialEnabled, initialHandle, initialBio }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [handle, setHandle] = useState(initialHandle)
  const [bio, setBio] = useState(initialBio)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const normalized = normalizeHandle(handle)
  const handleOk = !enabled || isValidHandle(normalized)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/profile/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_profile: enabled,
          handle: normalized,
          bio: bio.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setMsg({ ok: true, text: enabled ? `Live at /traders/${normalized}` : 'Profile is now private.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-amber-500"
        />
        <span className="text-sm">
          Publish a verified public profile &amp; appear on the leaderboard
        </span>
      </label>

      {enabled && (
        <>
          <div className="space-y-1">
            <label htmlFor="handle" className="text-xs text-muted-foreground">
              Public handle
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/traders/</span>
              <input
                id="handle"
                value={handle}
                onChange={e => setHandle(e.target.value)}
                placeholder="alpha-trader"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {handle && !handleOk && (
              <p className="text-xs text-destructive">
                3–20 chars: lowercase letters, numbers, dashes. Will be saved as
                <code className="mx-1">{normalized || '—'}</code>
              </p>
            )}
            {handle && handleOk && normalized !== handle && (
              <p className="text-xs text-muted-foreground">
                Saved as <code>{normalized}</code>
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="bio" className="text-xs text-muted-foreground">
              Bio <span className="opacity-60">(optional, max 200)</span>
            </label>
            <textarea
              id="bio"
              value={bio}
              maxLength={200}
              rows={2}
              onChange={e => setBio(e.target.value)}
              placeholder="Swing trader. Gold & majors. Risk-first."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Only aggregate stats from your trade journal are shown — never individual
            trades, never your email. You can turn this off anytime.
          </p>
        </>
      )}

      {msg && (
        <p className={cn('text-sm', msg.ok ? 'text-emerald-500' : 'text-destructive')}>
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || !handleOk}
        className={cn('btn-premium text-sm', (saving || !handleOk) && 'opacity-50 cursor-not-allowed')}
      >
        {saving ? 'Saving…' : 'Save profile visibility'}
      </button>
    </form>
  )
}
