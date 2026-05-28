'use client'
/**
 * LiveTicker — a thin realtime status strip for the Command Center.
 *
 * Polls /api/dashboard via useDashboard and shows the few numbers a trader
 * watches continuously (kill state, notional, daily P&L, open positions,
 * queue depth, desyncs) with a live indicator + "updated Ns ago". It sits
 * ABOVE the server-rendered KPI grid as a live layer — it does not replace
 * the SSR panels, so the page still renders fully without JS. Degrades to
 * "connecting…" then to the last good snapshot on transient errors.
 */
import { useEffect, useState } from 'react'
import { useDashboard } from '@/hooks/useDashboard'

const usd = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

function Ago({ ts }: { ts: number | null }) {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!ts) return <>—</>
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return <>{s}s ago</>
}

function Cell({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums leading-tight transition-colors duration-300 ${tone}`}>
        {value}
      </span>
    </div>
  )
}

export default function LiveTicker() {
  const { data, error, loading, lastUpdated } = useDashboard()
  const k = data?.kpis
  const live = !!data && !error

  const pnlTone = k && k.daily_realized_pnl > 0 ? 'text-emerald-500'
    : k && k.daily_realized_pnl < 0 ? 'text-red-500' : 'text-foreground'

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card/60 px-4 py-2.5">
      <span className="inline-flex items-center gap-2 text-xs font-semibold">
        <span className={`h-2 w-2 rounded-full ${
          data?.kill.active ? 'bg-red-500 animate-pulse'
          : live ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}`} />
        {data?.kill.active ? 'KILL ACTIVE' : live ? 'LIVE' : loading ? 'CONNECTING…' : 'STALE'}
      </span>

      <Cell label="Notional"   value={k ? usd(k.total_notional) : '—'} />
      <Cell label="Daily P&L"  value={k ? usd(k.daily_realized_pnl) : '—'} tone={pnlTone} />
      <Cell label="Positions"  value={k ? String(k.open_positions) : '—'} />
      <Cell label="Queue"      value={k ? String(k.queue_depth) : '—'}
            tone={k && k.queue_depth > 0 ? 'text-blue-400' : ''} />
      <Cell label="Desyncs"    value={k ? String(k.open_desyncs) : '—'}
            tone={k && k.open_desyncs > 0 ? 'text-amber-500' : 'text-emerald-500'} />
      <Cell label="Discipline" value={typeof k?.discipline_score === 'number' ? k.discipline_score.toFixed(0) : '—'} />

      <span className="ml-auto text-[10px] text-muted-foreground">
        {error ? <span className="text-amber-500">reconnecting · </span> : null}
        updated <Ago ts={lastUpdated} />
      </span>
    </div>
  )
}
