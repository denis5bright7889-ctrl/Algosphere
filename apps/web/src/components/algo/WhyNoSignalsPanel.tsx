'use client'
/**
 * WhyNoSignalsPanel — "what's actually blocking signal generation"
 *
 * Polls /api/diagnostics/trading (proxy → engine
 * /api/v1/diagnostics/trading) every 20s and renders the engine's
 * verdict + ranked suspects + the per-symbol gate state.
 *
 * The shape is verbatim from the engine — no client-side massaging,
 * because the institutional rule is no fabricated rationale. If the
 * engine is unreachable, the panel says so plainly instead of
 * pretending everything is fine.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ShieldCheck, Activity, Power, Search, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TradingDiagnostics } from '@/lib/engine-client'

const POLL_MS = 20_000

export default function WhyNoSignalsPanel() {
  const [data,  setData]  = useState<TradingDiagnostics | null>(null)
  const [err,   setErr]   = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/diagnostics/trading', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(j?.detail || j?.error || `HTTP ${r.status}`)
        setData(null)
      } else {
        setErr(null)
        setData(j as TradingDiagnostics)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const i = setInterval(refresh, POLL_MS)
    return () => clearInterval(i)
  }, [refresh])

  if (!data && !err) {
    return (
      <div className="surface p-5 flex items-center gap-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading diagnostics from engine…
      </div>
    )
  }

  if (err && !data) {
    return (
      <div className="surface border-amber-500/30 bg-amber-500/[0.04] p-5">
        <div className="flex items-center gap-2 text-xs text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Engine diagnostics unreachable — {err}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The engine isn't responding. Check SIGNAL_ENGINE_URL on Vercel and the Railway service status.
        </p>
      </div>
    )
  }

  if (!data) return null

  const verdictTone = data.summary.verdict.includes('healthy')
    ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200'
    : data.summary.verdict.includes('starved') || data.summary.verdict.includes('no signal ever')
      ? 'border-rose-500/40 bg-rose-500/[0.04] text-rose-200'
      : 'border-amber-500/40 bg-amber-500/[0.04] text-amber-200'

  const eng = data.engine
  const risk = data.institutional_risk
  const bars = data.bars
  const cb = data.circuit_breakers
  const active = data.active_signals

  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Search className="h-4 w-4 text-amber-300" />
            Why no signals?
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Live pipeline diagnostic · {new Date(data.generated_at).toLocaleTimeString()}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground/85 hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      {/* Verdict */}
      <div className={cn('mt-4 rounded-lg border p-3 text-xs', verdictTone)}>
        <div className="font-semibold uppercase tracking-wider text-[10px]">Verdict</div>
        <div className="mt-1 text-sm">{data.summary.verdict}</div>
      </div>

      {/* Suspects */}
      {data.summary.suspects.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Ranked suspects
          </div>
          <ol className="mt-1.5 space-y-1 text-[12px]">
            {data.summary.suspects.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[9px] font-bold text-amber-300">
                  {i + 1}
                </span>
                <span className="text-foreground/85">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Quick-state grid */}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <KvBlock icon={Power} label="Engine">
          <Row k="enabled" v={String(eng.signal_engine_enabled)} bad={!eng.signal_engine_enabled} />
          <Row k="dry_run" v={String(eng.signal_dry_run)} bad={eng.signal_dry_run} />
          <Row k="symbols" v={String(eng.symbol_count)} />
          <Row k="scan_int" v={`${eng.scan_interval_min}m`} />
        </KvBlock>

        <KvBlock icon={ShieldCheck} label="Risk engine">
          {risk.available ? (
            <>
              <Row k="state" v={risk.state ?? '—'} bad={risk.locked || risk.kill_switch_active} />
              <Row k="locked" v={String(!!risk.locked)} bad={!!risk.locked} />
              <Row k="kill_switch" v={String(!!risk.kill_switch_active)} bad={!!risk.kill_switch_active} />
              <Row k="open" v={String(risk.open_positions ?? '—')} />
              {typeof risk.total_drawdown_pct === 'number' && (
                <Row k="total_dd" v={`${risk.total_drawdown_pct}%`} bad={risk.total_drawdown_pct > 10} />
              )}
            </>
          ) : (
            <Row k="unavail" v={risk.reason ?? '—'} />
          )}
        </KvBlock>

        <KvBlock icon={Activity} label="Bars freshness">
          {bars.available ? (
            <>
              <Row k="fresh" v={String(bars.fresh ?? 0)} />
              <Row k="stale" v={String(bars.stale ?? 0)} bad={(bars.stale ?? 0) > 0} />
              <Row k="critical" v={String(bars.critical ?? 0)} bad={(bars.critical ?? 0) > 0} />
              <Row k="never_scanned" v={String(bars.never_scanned ?? 0)} bad={(bars.never_scanned ?? 0) > 0} />
            </>
          ) : (
            <Row k="unavail" v={bars.note ?? '—'} />
          )}
        </KvBlock>
      </div>

      {/* Per-symbol gate table */}
      {active.available && Array.isArray(active.symbols) && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Per-symbol state · {active.starved_symbols ?? 0} starved / {active.symbols.length}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[520px] text-[11px]">
              <thead className="bg-muted/30 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Symbol</th>
                  <th className="px-2 py-1.5 text-right">Active</th>
                  <th className="px-2 py-1.5">Breaker</th>
                  <th className="px-2 py-1.5">Bars</th>
                  <th className="px-2 py-1.5">Oldest open</th>
                </tr>
              </thead>
              <tbody>
                {active.symbols.map((s) => {
                  const breaker = cb.symbols?.[s.symbol]
                  const bar     = bars.symbols?.find((b) => b.symbol === s.symbol)
                  return (
                    <tr key={s.symbol} className="border-t border-border/40">
                      <td className="px-2 py-1 font-mono font-semibold">{s.symbol}</td>
                      <td className={cn('px-2 py-1 text-right tabular-nums',
                        s.starved ? 'text-rose-300 font-semibold' : '')}>
                        {s.active}/{active.max_active_per_symbol}
                      </td>
                      <td className="px-2 py-1">
                        {breaker?.is_open
                          ? <span className="text-rose-300">OPEN · {breaker.reason}</span>
                          : <span className="text-muted-foreground">ok</span>}
                      </td>
                      <td className="px-2 py-1">
                        {bar
                          ? <span className={bar.status === 'fresh' ? 'text-emerald-400'
                              : bar.status === 'stale' ? 'text-amber-300'
                              : 'text-rose-300'}>{bar.status}</span>
                          : '—'}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {s.oldest_open ? new Date(s.oldest_open).toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rejection breakdown from execution_trace.jsonl */}
      {data.rejection_trace_tail.available && data.rejection_trace_tail.rejection_breakdown && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Rejection breakdown · last {data.rejection_trace_tail.tail_count} traces
          </div>
          <ul className="space-y-0.5 text-[11px]">
            {Object.entries(data.rejection_trace_tail.rejection_breakdown).map(([k, n]) => (
              <li key={k} className="flex justify-between">
                <span className="font-mono">{k}</span>
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data.rejection_trace_tail.available && (
        <p className="mt-3 text-[10px] text-muted-foreground/70">
          Per-cycle trace file empty: {data.rejection_trace_tail.note}
        </p>
      )}
    </div>
  )
}

function KvBlock({ icon: Icon, label, children }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1.5 space-y-0.5 text-[11px]">{children}</div>
    </div>
  )
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn('font-mono tabular-nums', bad ? 'text-rose-300' : 'text-foreground/85')}>
        {v}
      </span>
    </div>
  )
}
