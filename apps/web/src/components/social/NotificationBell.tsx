'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Bell, UserPlus, Activity, CheckCircle2, Hourglass, Flag, Star,
  MessageCircle, Flame, AtSign, Wallet, Trophy, AlertTriangle, TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { CATEGORIES, categoryFor, type CategoryKey } from '@/lib/notifications/categories'
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

const NOTIF_ICONS: Record<string, LucideIcon> = {
  new_follower:          UserPlus,
  signal_from_leader:    Activity,
  new_signal:            Activity,
  smart_money_alert:     Activity,
  copy_trade_opened:     CheckCircle2,
  copy_trade_ready:      Hourglass,
  copy_trade_closed:     Flag,
  strategy_sub:          Star,
  new_comment:           MessageCircle,
  post_liked:            Flame,
  mention:               AtSign,
  earning_accrued:       Wallet,
  verification_approved: Trophy,
  verification_rejected: AlertTriangle,
  rank_change:           TrendingUp,
}

type TabKey = 'all' | CategoryKey

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function entityHref(n: Notification): string {
  switch (n.entity_type) {
    case 'thread': return `/community/${n.entity_id}`
    case 'signal': return `/signals`
    case 'post':   return `/social`
    default:
      if (n.notif_type === 'earning_accrued') return '/earnings'
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
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/social/notifications?limit=30')
      if (res.ok) {
        const d = await res.json()
        setItems(d.notifications ?? [])
        setUnread(d.unread_count ?? 0)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + 60s poll (fallback if realtime drops)
  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  // Supabase Realtime — INSERTs into social_notifications for this user.
  // (Async user lookup happens inside, but the cleanup MUST live on the
  //  outer effect so React invokes it on unmount.)
  useEffect(() => {
    const supabase = createBrowserClient()
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      channel = supabase
        .channel(`notif:${user.id}`)
        .on(
          'postgres_changes',
          {
            event:  'INSERT',
            schema: 'public',
            table:  'social_notifications',
            filter: `recipient_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as Notification
            setItems((prev) => {
              if (prev.some((p) => p.id === row.id)) return prev
              return [{ ...row, profiles: null }, ...prev].slice(0, 50)
            })
            if (!row.read) setUnread((c) => c + 1)
          },
        )
        .subscribe()
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

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
      setItems(arr => arr.map(i => i.id === n.id ? { ...i, read: true } : i))
      setUnread(c => Math.max(0, c - 1))
    }
    const href = entityHref(n)
    if (href !== '#') window.location.href = href
  }

  // Per-category counts (over the loaded slice)
  const counts = useMemo(() => {
    const totals: Record<TabKey, { all: number; unread: number }> = {
      all:       { all: items.length, unread: 0 },
      signals:   { all: 0, unread: 0 },
      execution: { all: 0, unread: 0 },
      copy:      { all: 0, unread: 0 },
      social:    { all: 0, unread: 0 },
      risk:      { all: 0, unread: 0 },
      education: { all: 0, unread: 0 },
      markets:   { all: 0, unread: 0 },
      system:    { all: 0, unread: 0 },
    }
    for (const n of items) {
      const k = categoryFor(n.notif_type)
      totals[k].all += 1
      if (!n.read) {
        totals[k].unread += 1
        totals.all.unread += 1
      }
    }
    return totals
  }, [items])

  const visible = useMemo(
    () => activeTab === 'all'
      ? items
      : items.filter((n) => categoryFor(n.notif_type) === activeTab),
    [items, activeTab],
  )

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        className="relative rounded-lg p-2 hover:bg-muted/40 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-card shadow-card-lift z-50 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <h3 className="text-sm font-bold">Notifications</h3>
            <div className="flex items-center gap-3 text-[11px]">
              <a href="/alerts" className="text-muted-foreground hover:text-foreground">Preferences</a>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-amber-300 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto px-2 py-2 border-b border-border/60 no-scrollbar">
            <TabPill
              label="All"
              count={counts.all.all}
              unread={counts.all.unread}
              active={activeTab === 'all'}
              onClick={() => setActiveTab('all')}
            />
            {CATEGORIES.map((c) => (
              <TabPill
                key={c.key}
                icon={c.icon}
                label={c.label}
                count={counts[c.key].all}
                unread={counts[c.key].unread}
                active={activeTab === c.key}
                onClick={() => setActiveTab(c.key)}
              />
            ))}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                Nothing in this bucket yet.
              </p>
            ) : (
              visible.map(n => {
                const Icon = NOTIF_ICONS[n.notif_type] ?? Bell
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors',
                      !n.read && 'bg-amber-500/[0.04]',
                    )}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-amber-300/80" strokeWidth={1.75} aria-hidden />
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
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TabPill({
  label, count, unread, active, onClick, icon: Icon,
}: {
  label: string
  count: number
  unread: number
  active: boolean
  onClick: () => void
  icon?: LucideIcon
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />}
      <span>{label}</span>
      {unread > 0 ? (
        <span className="rounded-full bg-rose-500 px-1.5 text-[9px] font-bold leading-[14px] text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : count > 0 ? (
        <span className="text-[10px] opacity-60 tabular-nums">{count}</span>
      ) : null}
    </button>
  )
}
