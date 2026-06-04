'use client'

/**
 * Psychology leaderboard opt-in toggle (Phase 3).
 *
 * Default OFF. Flipping it ON is the explicit consent action — the server
 * records Terms & Privacy acceptance timestamps and sets the opt-in flag.
 * Only opted-in + consented users ever appear on the public board, and
 * only aggregate scores are exposed (never raw trades or email).
 */
import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function LeaderboardOptInForm({ initialOptIn }: { initialOptIn: boolean }) {
  const [optIn, setOptIn] = useState(initialOptIn)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function toggle(next: boolean) {
    setSaving(true)
    setMsg(null)
    const prev = optIn
    setOptIn(next)   // optimistic
    try {
      const res = await fetch('/api/psychology/leaderboard/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opt_in: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setMsg({
        ok: true,
        text: next
          ? 'You now appear on the public psychology rankings.'
          : 'Removed from the public rankings.',
      })
    } catch (e) {
      setOptIn(prev)   // revert
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={optIn}
          disabled={saving}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-amber-500"
        />
        <span className="text-sm">
          <span className="font-medium">Participate in public psychology rankings</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Enabling this accepts the Terms of Service and Privacy Policy for leaderboard
            participation. Only aggregate scores (maturity, discipline, consistency, patience)
            are shown — never your individual trades or email. Off by default; turn off anytime.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider',
          optIn
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-border bg-muted/30 text-muted-foreground',
        )}>
          <Trophy className="h-3 w-3" strokeWidth={2} aria-hidden />
          {optIn ? 'Participating' : 'Private'}
        </span>
        {optIn && (
          <a href="/psychology/leaderboard" className="text-[12px] font-semibold text-amber-300 hover:underline">
            View rankings →
          </a>
        )}
      </div>

      {msg && (
        <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-destructive')}>{msg.text}</p>
      )}
    </div>
  )
}
