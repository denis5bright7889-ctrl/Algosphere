'use client'

/**
 * LiveStatePanel — the always-on right rail (the "Live State Panel").
 *
 * Replaces clutter dashboards with one persistent context column: market
 * regime/bias, the user's risk snapshot, broker connection state, and the
 * live signal feed. Every value is real (cheap `/api/live-state` poll —
 * no engine runs); empty states render honestly as "—" / "Not connected".
 *
 * Shown on xl+ screens only, so mid-size laptops keep nav + workspace
 * breathing room. Polls every 20s.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Radar, ShieldCheck, Landmark, Bell, Plug, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const POLL_MS = 20_000

interface LiveState {
  market: { regime: string; bias: string; scanned: number }
  risk: { totalNotional: number; openPositions: number; dailyPnl: number; drawdownUsd: number; concentration: number | null; hasData: boolean }
  broker: { state: 'live' | 'testnet' | 'error' | 'none'; label: string; broker: string | null; mode: string | null }
  alerts: { id: string; pair: string; direction: string; at: string }[]
  generatedAt: string
}

export default function LiveStatePanel() {
  const [data, setData] = useState<LiveState | null>(null)
  const [stale, setStale] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/live-state', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json()); setStale(false)
    } catch { setStale(true) }
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, POLL_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [load])

  return (
    <aside className="hidden xl:flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/70 bg-background/40 p-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Live State</span>
        <span className={cn('flex items-center gap-1 text-[9px] uppercase tracking-wider',
          stale ? 'text-amber-400' : 'text-emerald-400')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse')} aria-hidden />
          {stale ? 'reconnecting' : 'live'}
        </span>
      </div>

      <MarketCard data={data} />
      <RiskCard data={data} />
      <BrokerCard data={data} />
      <AlertsCard data={data} />
    </aside>
  )
}

function Card({ icon: Icon, title, href, children }: {
  icon: typeof Radar; title: string; href: string; children: React.ReactNode
}) {
  return (
    <Link href={href} className="block rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-primary/30">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        {title}
      </div>
      {children}
    </Link>
  )
}

function MarketCard({ data }: { data: LiveState | null }) {
  const m = data?.market
  const Bias = m?.bias === 'Bullish' ? TrendingUp : m?.bias === 'Bearish' ? TrendingDown : Minus
  const tone = m?.bias === 'Bullish' ? 'text-emerald-400' : m?.bias === 'Bearish' ? 'text-rose-400' : 'text-amber-300'
  return (
    <Card icon={Radar} title="Market State" href="/intelligence">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{m?.regime ?? '—'}</span>
        <span className={cn('flex items-center gap-1 text-sm font-bold', tone)}>
          <Bias className="h-4 w-4" strokeWidth={2} aria-hidden />
          {m?.bias ?? '—'}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {m && m.scanned > 0 ? `${m.scanned} instruments in latest pass` : 'Awaiting regime scan'}
      </p>
    </Card>
  )
}

function RiskCard({ data }: { data: LiveState | null }) {
  const r = data?.risk
  const pnlTone = !r || !r.hasData ? 'text-muted-foreground' : r.dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
  return (
    <Card icon={ShieldCheck} title="Risk" href="/risk">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Exposure" value={r?.hasData ? `$${fmt(r.totalNotional)}` : '—'} />
        <Metric label="Open" value={r?.hasData ? String(r.openPositions) : '—'} />
        <Metric label="Day P&L" value={r?.hasData ? `${r.dailyPnl >= 0 ? '+' : ''}$${fmt(r.dailyPnl)}` : '—'} tone={pnlTone} />
        <Metric label="Drawdown" value={r?.hasData ? `$${fmt(r.drawdownUsd)}` : '—'} />
      </div>
    </Card>
  )
}

function BrokerCard({ data }: { data: LiveState | null }) {
  const b = data?.broker
  const map: Record<string, { cls: string; dot: string }> = {
    live:    { cls: 'text-emerald-300', dot: 'bg-emerald-400' },
    testnet: { cls: 'text-blue-300',    dot: 'bg-blue-400' },
    error:   { cls: 'text-rose-300',    dot: 'bg-rose-400' },
    none:    { cls: 'text-amber-300',   dot: 'bg-amber-400' },
  }
  const s = map[b?.state ?? 'none'] ?? map.none!
  return (
    <Card icon={Landmark} title="Broker" href="/brokers">
      <div className={cn('flex items-center gap-2 text-sm font-semibold', s.cls)}>
        {b?.state === 'none' || b?.state === 'error'
          ? <Plug className="h-4 w-4" strokeWidth={2} aria-hidden />
          : <span className={cn('h-2 w-2 rounded-full', s.dot)} aria-hidden />}
        {b?.broker ? `${b.label} · ${b.broker}` : (b?.label ?? '—')}
      </div>
      {(b?.state === 'none') && (
        <p className="mt-1 text-[10px] text-amber-300/80">Tap to connect a broker →</p>
      )}
    </Card>
  )
}

function AlertsCard({ data }: { data: LiveState | null }) {
  const a = data?.alerts ?? []
  return (
    <Card icon={Bell} title="Live Signals" href="/signals">
      {a.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No active signals right now.</p>
      ) : (
        <ul className="space-y-1.5">
          {a.slice(0, 5).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono font-semibold">{s.pair}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                s.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
                {s.direction}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Metric({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('font-mono text-sm font-bold tabular-nums', tone)}>{value}</p>
    </div>
  )
}

function fmt(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}
