'use client'

/**
 * ActionDock — the persistent bottom terminal dock (MT5-style toolbox,
 * not copied: our own tab set + AI-native framing).
 *
 * This is the fix for the recurring "where is journal? where is broker?"
 * problem: the actions a trader needs are docked at the bottom of the
 * workspace, ALWAYS one click away — never a page hunt. Collapsible to a
 * thin tab strip; remembers its open/active state.
 *
 *   Positions · Orders · Journal · Brokers · Alerts
 *
 * Plus an always-visible "Quick Log" button (one click to record a trade).
 * Every value is real — cheap polls of /api/live-state + /api/dashboard +
 * /api/journal (no engine runs). Honest empty states throughout.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronUp, Plus, Layers, ListOrdered, BookOpen, Landmark, Bell, Plug,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TabKey = 'positions' | 'orders' | 'journal' | 'brokers' | 'alerts'
const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'positions', label: 'Positions', icon: Layers },
  { key: 'orders',    label: 'Orders',    icon: ListOrdered },
  { key: 'journal',   label: 'Journal',   icon: BookOpen },
  { key: 'brokers',   label: 'Brokers',   icon: Landmark },
  { key: 'alerts',    label: 'Alerts',    icon: Bell },
]

const LS_OPEN = 'as_dock_open'
const LS_TAB  = 'as_dock_tab'
const POLL_MS = 20_000

interface Live {
  risk: { totalNotional: number; openPositions: number; dailyPnl: number; drawdownUsd: number; hasData: boolean }
  broker: { state: 'live' | 'testnet' | 'error' | 'none'; label: string; broker: string | null }
  alerts: { id: string; pair: string; direction: string; at: string }[]
}
interface Job { id: string; kind: string; status: string; computed_lot: number | null; created_at: string }
interface Dash { recent_jobs: Job[]; coach_alerts: { id: string; title: string; severity: string; created_at: string }[] }
interface JournalEntry { id: string; pair: string; direction: string; pnl: number | null; trade_date: string }

export default function ActionDock() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<TabKey>('positions')
  const [mounted, setMounted] = useState(false)

  const [live, setLive] = useState<Live | null>(null)
  const [dash, setDash] = useState<Dash | null>(null)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Honour saved preference; otherwise default OPEN on desktop and
    // CLOSED on mobile (so the chart breathes — the dock collapses to a
    // tab strip the user can tap to expand). Desktop default unchanged.
    const saved = localStorage.getItem(LS_OPEN)
    if (saved === '1') setOpen(true)
    else if (saved === '0') setOpen(false)
    else setOpen(window.matchMedia('(min-width: 768px)').matches)

    const t = localStorage.getItem(LS_TAB) as TabKey | null
    if (t && TABS.some((x) => x.key === t)) setTab(t)
    setMounted(true)
  }, [])

  const load = useCallback(async () => {
    const [l, d, j] = await Promise.allSettled([
      fetch('/api/live-state', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null),
      fetch('/api/dashboard',  { cache: 'no-store' }).then((r) => r.ok ? r.json() : null),
      fetch('/api/journal',    { cache: 'no-store' }).then((r) => r.ok ? r.json() : null),
    ])
    if (l.status === 'fulfilled' && l.value) setLive(l.value)
    if (d.status === 'fulfilled' && d.value) setDash(d.value)
    if (j.status === 'fulfilled' && j.value?.data) setJournal(j.value.data.slice(0, 6))
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, POLL_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  function toggle() {
    setOpen((v) => { const n = !v; localStorage.setItem(LS_OPEN, n ? '1' : '0'); return n })
  }
  function pick(k: TabKey) {
    setTab(k); localStorage.setItem(LS_TAB, k)
    if (!open) toggle()
  }

  return (
    <div className={cn(
      'shrink-0 overflow-hidden rounded-xl border border-border/70 bg-card transition-[height] duration-200 ease-out',
      mounted ? '' : 'duration-0',
      open ? 'h-56' : 'h-10',
    )}>
      {/* Tab strip */}
      <div className="flex h-10 items-center gap-1 border-b border-border/60 px-2">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = open && tab === t.key
          const badge = t.key === 'positions' ? live?.risk.openPositions
            : t.key === 'alerts' ? live?.alerts.length
            : t.key === 'orders' ? dash?.recent_jobs.length
            : undefined
          return (
            <button
              key={t.key} type="button" onClick={() => pick(t.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
                active ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              <span className="hidden sm:inline">{t.label}</span>
              {badge ? <span className="rounded-full bg-muted/50 px-1.5 text-[9px] tabular-nums">{badge}</span> : null}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href="/journal"
            className="flex items-center gap-1 rounded-lg bg-gradient-primary px-2.5 py-1.5 text-[11px] font-bold text-black shadow-glow-gold"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            <span className="hidden sm:inline">Quick Log</span>
          </Link>
          <button
            type="button" onClick={toggle} aria-label={open ? 'Collapse dock' : 'Expand dock'}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            {open ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                  : <ChevronUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          </button>
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="h-[calc(14rem-2.5rem)] overflow-y-auto p-3 text-sm">
          {tab === 'positions' && <Positions live={live} />}
          {tab === 'orders'    && <Orders jobs={dash?.recent_jobs ?? []} />}
          {tab === 'journal'   && <Journal entries={journal} />}
          {tab === 'brokers'   && <Brokers live={live} />}
          {tab === 'alerts'    && <Alerts live={live} coach={dash?.coach_alerts ?? []} />}
        </div>
      )}
    </div>
  )
}

function Positions({ live }: { live: Live | null }) {
  const r = live?.risk
  if (!r?.hasData) return <Empty msg="No open positions. Connect a broker and follow a strategy to populate." />
  const pnlTone = r.dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Open Positions" value={String(r.openPositions)} />
      <Stat label="Exposure" value={`$${fmt(r.totalNotional)}`} />
      <Stat label="Day P&L" value={`${r.dailyPnl >= 0 ? '+' : ''}$${fmt(r.dailyPnl)}`} tone={pnlTone} />
      <Stat label="Drawdown" value={`$${fmt(r.drawdownUsd)}`} />
    </div>
  )
}

function Orders({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return <Empty msg="No recent orders." />
  return (
    <ul className="space-y-1.5">
      {jobs.map((j) => (
        <li key={j.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="font-mono">{j.kind}{j.computed_lot ? ` · ${j.computed_lot}` : ''}</span>
          <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
            j.status === 'filled' ? 'bg-emerald-500/15 text-emerald-300'
            : j.status === 'failed' ? 'bg-rose-500/15 text-rose-300'
            : 'bg-muted/40 text-muted-foreground')}>
            {j.status}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Journal({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-xs text-muted-foreground">No journal entries yet.</p>
        <Link href="/journal" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary/40">
          Log your first trade →
        </Link>
      </div>
    )
  }
  return (
    <ul className="space-y-1.5">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2">
            <span className="font-mono font-semibold">{e.pair}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
              e.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
              {e.direction}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span className={cn('font-mono tabular-nums', (e.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {e.pnl != null ? `${e.pnl >= 0 ? '+' : ''}$${fmt(e.pnl)}` : '—'}
            </span>
            <span className="text-[10px] text-muted-foreground">{e.trade_date}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Brokers({ live }: { live: Live | null }) {
  const b = live?.broker
  const none = !b || b.state === 'none'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className={cn('text-sm font-semibold',
        b?.state === 'live' ? 'text-emerald-300' : b?.state === 'testnet' ? 'text-blue-300'
        : b?.state === 'error' ? 'text-rose-300' : 'text-amber-300')}>
        {b?.broker ? `${b.label} · ${b.broker}` : (b?.label ?? '—')}
      </p>
      <Link href="/brokers" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary/40">
        <Plug className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {none ? 'Connect a broker' : 'Manage brokers'}
      </Link>
    </div>
  )
}

function Alerts({ live, coach }: { live: Live | null; coach: { id: string; title: string; severity: string }[] }) {
  const signals = live?.alerts ?? []
  if (signals.length === 0 && coach.length === 0) return <Empty msg="No active signals or alerts." />
  return (
    <ul className="space-y-1.5 text-xs">
      {signals.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Bell className="h-3 w-3 text-amber-300" aria-hidden />
            <span className="font-mono font-semibold">{s.pair}</span></span>
          <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
            s.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>{s.direction}</span>
        </li>
      ))}
      {coach.map((c) => (
        <li key={c.id} className="flex items-center gap-2 text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full',
            c.severity === 'high' ? 'bg-rose-400' : c.severity === 'medium' ? 'bg-amber-400' : 'bg-muted-foreground')} aria-hidden />
          <span className="truncate">{c.title}</span>
        </li>
      ))}
    </ul>
  )
}

function Stat({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 font-mono text-base font-bold tabular-nums', tone)}>{value}</p>
    </div>
  )
}
function Empty({ msg }: { msg: string }) {
  return <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">{msg}</div>
}
function fmt(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}
