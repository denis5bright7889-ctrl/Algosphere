'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface Notification {
  id:          string
  actor_id:    string | null
  notif_type:  string
  entity_type: string | null
  entity_id:   string | null
  message:     string
  read:        boolean
  created_at:  string
  profiles:    { public_handle: string | null } | null
}

const NOTIF_ICONS: Record<string, string> = {
  new_follower:        '👤',
  signal_from_leader:  '📡',
  copy_trade_opened:   '✅',
  copy_trade_ready:    '⏳',
  copy_trade_closed:   '🏁',
  strategy_sub:        '⭐',
  new_comment:         '💬',
  post_liked:          '🔥',
  mention:             '@',
  earning_accrued:     '💰',
  verification_approved: '🏆',
  verification_rejected: '⚠️',
  rank_change:         '📈',
}

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function entityHref(n: Notification): string {
  switch (n.entity_type) {
    case 'thread': return `/dashboard/community/${n.entity_id}`
    case 'signal': return `/dashboard/signals`
    case 'post':   return `/dashboard/social`
    default:
      if (n.notif_type === 'earning_accrued') return '/dashboard/earnings'
      if (n.notif_type === 'new_follower' && n.profiles?.public_handle)
        return `/traders/${n.profiles.public_handle}`
      return '#'
  }
}

export default function NotificationBell() {
  const [open, setOpen]     = useState(false)
  const [items, setItems]   = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/social/notifications?limit=15')
      if (res.ok) {
        const d = await res.json()
        setItems(d.notifications ?? [])
        setUnread(d.unread_count ?? 0)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll unread count every 60s
  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function markAllRead() {
    await fetch('/api/social/notifications', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ all: true }),
    })
    setItems(arr => arr.map(n => ({ ...n, read: true })))
    setUnread(0)
  }

  async function onItemClick(n: Notification) {
    if (!n.read) {
      await fetch('/api/social/notifications', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: [n.id] }),
      })
      setUnread(c => Math.max(0, c - 1))
    }
    const href = entityHref(n)
    if (href !== '#') window.location.href = href
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        className="relative rounded-lg p-2 hover:bg-muted/40 transition-colors"
        aria-label="Notifications"
      >
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-card shadow-card-lift z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-bold">Notifications</h3>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-amber-300 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                Loading…
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              items.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors',
                    !n.read && 'bg-amber-500/[0.04]',
                  )}
                >
                  <span className="text-base flex-shrink-0">
                    {NOTIF_ICONS[n.notif_type] ?? '🔔'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-snug">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {timeAgo(n.created_at)} ago
                    </p>
                  </div>
                  {!n.read && (
                    <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0 mt-1" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
