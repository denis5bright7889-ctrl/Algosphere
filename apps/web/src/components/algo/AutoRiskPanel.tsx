'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface RiskTelemetry {
  state: 'ACTIVE' | 'COOLDOWN' | 'LOCKED'
  account_login: string
  current_equity: number
  peak_equity: number
  initial_equity: number
  total_drawdown_pct: number
  daily_drawdown_pct: number
  weekly_drawdown_pct: number
  daily_pnl: number
  weekly_pnl: number
  consecutive_wins: number
  consecutive_losses: number
  cooldown_until: string | null
  locked: boolean
  locked_reason: string
  open_positions: number
  kill_switch_active: boolean
  adaptive_multiplier: number
  broker_connected: boolean
  last_refreshed: string
  last_broker_sync: string | null
  limits: {
    daily_loss_limit_pct: number
    weekly_loss_limit_pct: number
    max_total_drawdown_pct: number
    max_consecutive_losses: number
    max_open_positions: number
  }
}

export default function AutoRiskPanel() {
  const [data, setData] = useState<RiskTelemetry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        // Proxied through Next.js route — enforces premium tier server-side
        const res = await fetch('/api/risk/telemetry', { cache: 'no-store' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const json = await res.json() as RiskTelemetry
        if (alive) {
          setData(json)
          setError(null)
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to fetch')
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(interval) }
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Loading risk telemetry...</p>
      </div>
    )
  }

  if (error || !data) {
    const isPermission = !!error && /subscription|required|forbidden|unauthor/i.test(error)
    const isEngineDown = !!error && /unreachable|engine|50\d|configured/i.test(error)
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="text-sm font-medium text-amber-600">
          {isPermission ? 'Risk Engine locked' : 'Auto Risk Engine offline'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {error ?? 'No telemetry available'}.
          {isPermission && !isEngineDown && (
            <> Upgrade to the Pro plan (or higher) to unlock the institutional risk engine.</>
          )}
          {isEngineDown && (
            <> The signal-engine service may not be deployed or{' '}
            <code className="text-xs">NEXT_PUBLIC_SIGNAL_ENGINE_API_URL</code> is unset.</>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <RiskBanners data={data} />
      <RiskHeader data={data} />
      <RiskMetricsGrid data={data} />
      <RiskFooter data={data} />
    </div>
  )
}


function RiskBanners({ data }: { data: RiskTelemetry }) {
  const banners: { tone: 'red' | 'amber' | 'blue'; title: string; body: string }[] = []

  if (data.kill_switch_active) {
    banners.push({
      tone: 'red',
      title: 'KILL SWITCH TRIGGERED',
      body: data.locked_reason || 'Trading halted — operator intervention required',
    })
  } else if (data.locked) {
    banners.push({
      tone: 'red',
      title: 'ENGINE LOCKED',
      body: data.locked_reason,
    })
  }

  if (data.daily_drawdown_pct >= data.limits.daily_loss_limit_pct * 100) {
    banners.push({
      tone: 'amber',
      title: 'Daily Limit Reached',
      body: `Daily drawdown ${data.daily_drawdown_pct.toFixed(2)}% — trading paused until UTC midnight`,
    })
  }

  if (data.weekly_drawdown_pct >= data.limits.weekly_loss_limit_pct * 100) {
    banners.push({
      tone: 'amber',
      title: 'Weekly Halt Active',
      body: `Weekly drawdown ${data.weekly_drawdown_pct.toFixed(2)}% — resumes Monday UTC`,
    })
  }

  if (data.state === 'COOLDOWN' && !data.locked) {
    banners.push({
      tone: 'blue',
      title: 'Cooldown Active',
      body: data.cooldown_until
        ? `Trading resumes at ${new Date(data.cooldown_until).toLocaleString()}`
        : 'Consecutive-loss cooldown in effect',
    })
  }

  if (!data.broker_connected) {
    banners.push({
      tone: 'amber',
      title: 'Broker Offline',
      body: 'Using cached equity — risk gates still active',
    })
  }

  if (banners.length === 0) return null

  const toneStyle = {
    red:   'border-red-500/40 bg-red-500/10 text-red-600',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
    blue:  'border-blue-500/40 bg-blue-500/10 text-blue-600',
  }

  return (
    <div className="space-y-2">
      {banners.map((b, i) => (
        <div key={i} className={cn('rounded-lg border px-4 py-3', toneStyle[b.tone])}>
          <p className="text-sm font-bold tracking-wide">{b.title}</p>
          <p className="text-xs mt-0.5 opacity-90">{b.body}</p>
        </div>
      ))}
    </div>
  )
}


function StateBadge({ state }: { state: RiskTelemetry['state'] }) {
  const meta = {
    ACTIVE:   { color: 'bg-emerald-500', label: 'ACTIVE',   pulse: true  },
    COOLDOWN: { color: 'bg-amber-500',   label: 'COOLDOWN', pulse: false },
    LOCKED:   { color: 'bg-red-500',     label: 'LOCKED',   pulse: false },
  }[state]

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-muted/30 px-3 py-1">
      <span className={cn('h-2 w-2 rounded-full', meta.color, meta.pulse && 'animate-pulse')} />
      <span className="text-xs font-bold tracking-wider">{meta.label}</span>
    </span>
  )
}


function RiskHeader({ data }: { data: RiskTelemetry }) {
  const equityChange = data.current_equity - data.initial_equity
  const equityPct = data.initial_equity > 0 ? (equityChange / data.initial_equity) * 100 : 0

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold">Auto Risk Engine</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Institutional capital protection — account {data.account_login}
          </p>
        </div>
        <StateBadge state={data.state} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Current Equity" value={`$${data.current_equity.toLocaleString()}`}
              sub={`${equityPct >= 0 ? '+' : ''}${equityPct.toFixed(2)}% all-time`}
              tone={equityPct >= 0 ? 'green' : 'red'} />
        <Stat label="Peak Equity" value={`$${data.peak_equity.toLocaleString()}`}
              sub={`Drawdown ${data.total_drawdown_pct.toFixed(2)}%`}
              tone={data.total_drawdown_pct > 0 ? 'red' : 'default'} />
        <Stat label="Adaptive Multiplier" value={`${data.adaptive_multiplier.toFixed(2)}x`}
              sub={data.adaptive_multiplier > 1 ? 'boosted' : data.adaptive_multiplier < 1 ? 'reduced' : 'baseline'}
              tone="default" />
      </div>
    </div>
  )
}


function RiskMetricsGrid({ data }: { data: RiskTelemetry }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ProgressCard
        label="Daily Drawdown"
        current={data.daily_drawdown_pct}
        limit={data.limits.daily_loss_limit_pct * 100}
        pnl={data.daily_pnl}
      />
      <ProgressCard
        label="Weekly Drawdown"
        current={data.weekly_drawdown_pct}
        limit={data.limits.weekly_loss_limit_pct * 100}
        pnl={data.weekly_pnl}
      />
      <ProgressCard
        label="Total Drawdown"
        current={data.total_drawdown_pct}
        limit={data.limits.max_total_drawdown_pct * 100}
        critical
      />
      <StreaksCard data={data} />
    </div>
  )
}


function ProgressCard({
  label, current, limit, pnl, critical,
}: { label: string; current: number; limit: number; pnl?: number; critical?: boolean }) {
  const pct = Math.min((current / limit) * 100, 100)
  const fillTone =
    pct >= 100
      ? '[&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500'
      : pct >= 75
      ? '[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500'
      : critical
      ? '[&::-webkit-progress-value]:bg-orange-500 [&::-moz-progress-bar]:bg-orange-500'
      : '[&::-webkit-progress-value]:bg-emerald-500 [&::-moz-progress-bar]:bg-emerald-500'

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn('text-sm font-bold tabular-nums', pct >= 75 && 'text-amber-600', pct >= 100 && 'text-red-600')}>
          {current.toFixed(2)}% / {limit.toFixed(1)}%
        </span>
      </div>
      <progress
        value={pct}
        max={100}
        aria-label={label}
        className={cn(
          'h-2 w-full appearance-none overflow-hidden rounded-full',
          '[&::-webkit-progress-bar]:bg-muted/30 [&::-webkit-progress-bar]:rounded-full',
          '[&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-all',
          '[&::-moz-progress-bar]:rounded-full',
          fillTone,
        )}
      />
      {pnl !== undefined && (
        <p className={cn('mt-2 text-xs tabular-nums', pnl >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          P&L: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
        </p>
      )}
    </div>
  )
}


function StreaksCard({ data }: { data: RiskTelemetry }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3">Performance Streaks</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Consecutive Wins</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">{data.consecutive_wins}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Consecutive Losses</p>
          <p className={cn(
            'text-2xl font-bold tabular-nums',
            data.consecutive_losses >= data.limits.max_consecutive_losses - 1
              ? 'text-red-600'
              : data.consecutive_losses >= 2
              ? 'text-amber-600'
              : 'text-foreground'
          )}>
            {data.consecutive_losses} / {data.limits.max_consecutive_losses}
          </p>
        </div>
        <div className="col-span-2 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">Open Positions</p>
          <p className="text-lg font-bold tabular-nums">
            {data.open_positions} / {data.limits.max_open_positions}
          </p>
        </div>
      </div>
    </div>
  )
}


function RiskFooter({ data }: { data: RiskTelemetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground px-1">
      <span>
        Last refresh: {data.last_refreshed ? new Date(data.last_refreshed).toLocaleTimeString() : '—'}
      </span>
      <span>
        Broker sync: {data.last_broker_sync ? new Date(data.last_broker_sync).toLocaleTimeString() : 'offline'}
      </span>
      <span className={cn(data.broker_connected ? 'text-emerald-600' : 'text-amber-600')}>
        {data.broker_connected ? '● broker connected' : '○ broker offline (cached)'}
      </span>
    </div>
  )
}


function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string;
  tone?: 'green' | 'red' | 'default'
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-bold tabular-nums',
        tone === 'green' && 'text-emerald-600',
        tone === 'red' && 'text-red-600',
      )}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
