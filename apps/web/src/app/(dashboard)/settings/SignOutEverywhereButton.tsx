'use client'

import { useState, useTransition } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Revokes ALL active sessions (every browser, every device) for the
 * signed-in user by calling Supabase's global sign-out, then redirects
 * to /login. Confirms before firing to avoid accidental click-out.
 */
export default function SignOutEverywhereButton() {
  const [confirming, setConfirming] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [pending, startTransition]  = useTransition()

  function fire() {
    setError(null)
    startTransition(async () => {
      try {
        const supabase = createClient()
        const { error } = await supabase.auth.signOut({ scope: 'global' })
        if (error) throw error
        window.location.href = '/login'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to sign out')
        setConfirming(false)
      }
    })
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Sign out everywhere
        </button>
        {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        Revoke every active session?
      </span>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-lg border border-border px-3 py-1.5 text-xs"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={fire}
        disabled={pending}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300',
          pending && 'opacity-60 cursor-not-allowed',
        )}
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden />}
        {pending ? 'Signing out…' : 'Confirm sign out'}
      </button>
    </div>
  )
}
