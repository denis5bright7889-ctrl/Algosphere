'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface OpenRow {
  id: string; symbol: string; direction: string; follower_lot: number
  follower_entry: number | null; status: string; created_at: string
}
interface ClosedRow {
  id: string; symbol: string; direction: string; follower_lot: number
  follower_pnl: number | null; follower_pnl_pct: number | null
  status: string; closed_at: string
}

interface RiskTelemetry {
  state?: string
  current_equity?: number
  daily_drawdown_pct?: number
  weekly_drawdown_pct?: number
  total_drawdown_pct?: number
  kill_switch_active?: boolean
  locked?: boolean
}

export default function ExecutionClient({
  open, closed,
}: { open: OpenRow[]; closed: ClosedRow[] }) {
  const [risk, setRisk] = useState<RiskTelemetry | null>(null)
  const [tab, setTab]   = useState<'open' | 'closed' | 'risk'>('open')

  // Poll the existing risk telemetry endpoint every 20s
  useEffect(() => {
    let active = true
    const load = () =>
      fetch('/api/risk/telemetry')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (active && d) setRisk(d) })
        .catch(() => {})
    load()
    const t = setInterval(load, 20_000)
    return () => { active = false; clearInterval(t) }
  }, [])

  return (
    <>
      {/* Risk telemetry banner */}
      {risk && (
        <div className={cn(
          'rounded-2xl border p-4 mb-5',
          risk.kill_switch_active || risk.locked
            ? 'border-rose-500/40 bg-rose-500/[0.05]'
            : 'border-border bg-card',
        )}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className={cn(
                'h-2 w-2 rounded-full',
                risk.kill_switch_active || risk.locked
                  ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400',
              )} />
              <span className="text-sm font-bold">
                Risk Engine: {risk.kill_switch_active ? 'KILL SWITCH ACTIVE'
                  : risk.locked ? 'LOCKED'
                  : (risk.state ?? 'ACTIVE')}
              </span>
            </div>
            <div className="flex gap-4 text-xs">
              <Telem label="Daily DD"  v={risk.daily_drawdown_pct} />
              <Telem label="Weekly DD" v={risk.weekly_drawdown_pct} />
              <Telem label="Total DD"  v={risk.total_drawdown_pct} />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        {(['open', 'closed', 'risk'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium capitalize transition-colors',
              tab === t ? 'text-amber-300' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'risk' ? 'Risk Metrics' : `${t} (${t === 'open' ? open.length : closed.length})`}
            {tab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-300" />}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <Table
          empty="No open positions. Auto-execution will populate this in real time."
          headers={['Symbol', 'Side', 'Lots', 'Entry', 'Status', 'Opened']}
          rows={open.map(o => [
            o.symbol,
            o.direction.toUpperCase(),
            String(o.follower_lot ?? '—'),
            o.follower_entry != null ? String(o.follower_entry) : 'pending',
            o.status,
            new Date(o.created_at).toLocaleString(),
          ])}
          sideCol={1}
        />
      )}

      {tab === 'closed' && (
        <Table
          empty="No closed trades yet."
          headers={['Symbol', 'Side', 'Lots', 'PnL', 'PnL %', 'Closed']}
          rows={closed.map(c => [
            c.symbol,
            c.direction.toUpperCase(),
            String(c.follower_lot ?? '—'),
            `${Number(c.follower_pnl ?? 0) >= 0 ? '+' : ''}$${Number(c.follower_pnl ?? 0).toFixed(2)}`,
            c.follower_pnl_pct != null ? `${c.follower_pnl_pct}%` : '—',
            c.closed_at ? new Date(c.closed_at).toLocaleString() : '—',
          ])}
          sideCol={1}
          pnlCol={3}
        />
      )}

      {tab === 'risk' && (
        <div className="rounded-2xl border border-border bg-card p-6">
          {risk ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Metric label="Engine State"  value={risk.state ?? 'ACTIVE'} />
              <Metric label="Current Equity" value={risk.current_equity != null ? `$${risk.current_equity.toLocaleString()}` : '—'} />
              <Metric label="Kill Switch"   value={risk.kill_switch_active ? 'ACTIVE' : 'Clear'} />
              <Metric label="Daily DD"   value={fmtPct(risk.daily_drawdown_pct)} />
              <Metric label="Weekly DD"  value={fmtPct(risk.weekly_drawdown_pct)} />
              <Metric label="Total DD"   value={fmtPct(risk.total_drawdown_pct)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              Risk telemetry stream connecting…
            </p>
          )}
        </div>
      )}
    </>
  )
}

function fmtPct(v?: number) {
  return v == null ? '—' : `${(v * 100).toFixed(2)}%`
}

function Telem({ label, v }: { label: string; v?: number }) {
  return (
    <span className="text-muted-foreground">
      {label}: <strong className="text-foreground tabular-nums">{fmtPct(v)}</strong>
    </span>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

function Table({ headers, rows, empty, sideCol, pnlCol }: {
  headers: string[]
  rows: string[][]
  empty: string
  sideCol?: number
  pnlCol?: number
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    )
  }
  return (
    <>
      {/* Mobile: per-row card */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((r, i) => {
          const side = sideCol != null ? r[sideCol] : null
          const pnl  = pnlCol  != null ? r[pnlCol]  : null
          return (
            <li key={i} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold truncate">{r[0]}</span>
                {side && (
                  <span className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0',
                    side === 'BUY' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                  )}>
                    {side}
                  </span>
                )}
                {pnl && (
                  <span className={cn(
                    'tabular-nums text-sm font-semibold shrink-0',
                    pnl.startsWith('+') ? 'text-emerald-400' : 'text-rose-400',
                  )}>
                    {pnl}
                  </span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                {headers.map((h, j) => {
                  if (j === 0 || j === sideCol || j === pnlCol) return null
                  return (
                    <div key={h} className="flex justify-between gap-2 min-w-0">
                      <dt className="text-muted-foreground truncate">{h}</dt>
                      <dd className="tabular-nums text-right truncate">{r[j]}</dd>
                    </div>
                  )
                })}
              </dl>
            </li>
          )
        })}
      </ul>

      {/* Desktop: classic table */}
      <div className="hidden md:block rounded-2xl border border-border bg-card overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground uppercase tracking-wider">
              {headers.map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/10">
                {r.map((cell, j) => (
                  <td key={j} className={cn(
                    'px-4 py-3 tabular-nums',
                    sideCol === j && (cell === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'),
                    pnlCol === j && (cell.startsWith('+') ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'),
                  )}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
