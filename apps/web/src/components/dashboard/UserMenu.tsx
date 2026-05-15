'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { SubscriptionTier } from '@/lib/types'

interface Props {
  email: string
  name: string
  tier: string
}

const TIER_BADGE: Record<string, string> = {
  free: 'bg-muted text-muted-foreground',
  starter: 'bg-blue-100 text-blue-700',
  premium: 'bg-yellow-100 text-yellow-700',
}

export default function UserMenu({ email, name, tier }: Props) {
  const [open, setOpen] = useState(false)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const initials = (name || email)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {initials}
        </div>
        <span
          className={cn(
            'hidden sm:inline rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
            TIER_BADGE[tier] ?? TIER_BADGE.free
          )}
        >
          {tier}
        </span>
        <span className="text-muted-foreground text-xs">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-card shadow-md">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium truncate">{name || email}</p>
              <p className="text-xs text-muted-foreground truncate">{email}</p>
            </div>
            <div className="p-1">
              <a
                href="/settings"
                className="flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                Settings
              </a>
              {tier !== 'premium' && tier !== 'vip' && (
                <a
                  href="/upgrade"
                  className="flex w-full items-center rounded-sm px-3 py-2 text-sm text-primary font-medium hover:bg-accent"
                  onClick={() => setOpen(false)}
                >
                  Upgrade plan ✨
                </a>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center rounded-sm px-3 py-2 text-sm text-destructive hover:bg-accent"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
