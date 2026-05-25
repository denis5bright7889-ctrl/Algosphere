'use client'
/**
 * CrossAssetNarrative — top-of-market regime panel.
 *
 * Polls /api/market/narrative every 60s (visibility-aware), renders the
 * classified regime (Risk-On / Risk-Off / Volatile / Trend Expansion /
 * Ranging) with a one-line summary and the underlying signal % moves.
 * No new deps; same fetch + setInterval pattern as useDashboard.
 *
 * Coverage is shown honestly: 'crypto-only' if Twelve Data isn't keyed,
 * 'partial' if upstream is unreachable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Signal {
  symbol: string; price: number | null; pct_24h: number | null
  provider: 'binance' | 'twelvedata'
}
type Regime = 'risk_on' | 'risk_off' | 'volatile' | 'trend_expansion' | 'ranging' | 'unknown'
interface Narrative {
  regime: Regime; label: string; summary: string
  signals: Signal[]; coverage: 'full' | 'partial' | 'crypto-only'
  generated_at: string
}

const REGIME_TONE: Record<Regime, string> = {
  risk_on:         'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  risk_off:        'bg-red-500/15 text-red-300 border-red-500/35',
  volatile:        'bg-orange-500/15 text-orange-300 border-orange-500/40',
  trend_expansion: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
  ranging:         'bg-blue-500/15 text-blue-300 border-blue-500/30',
  unknown:         'bg-muted/40 text-muted-foreground border-border',
}

const pct = (v: number | null) =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export default function CrossAssetNarrative() {
  const [data, setData] = useState<Narrative | null>(null)
  const [err,  setErr]  = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const r = await fetch('/api/market/narrative', { signal: ac.signal, cache: 'no-store' })
      if (!r.ok) throw new Error(`narrative ${r.status}`)
      setData(await r.json() as Narrative)
      setErr(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setErr((e as Error).message)
    }
  }, [])

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!t) { load(); t = setInterval(load, 60_000) } }
    const stop  = () => { if (t)  { clearInterval(t); t = null } }
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); stop(); abortRef.current?.abort() }
  }, [load])

  if (!data && !err) {
    return <div className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">Reading the market…</div>
  }
  if (!data && err) {
    return <div className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">Market narrative unavailable.</div>
  }
  if (!data) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
          AI Market Narrative
        </span>
        <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider', REGIME_TONE[data.regime])}>
          {data.label}
        </span>
        {data.coverage !== 'full' && (
          <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            coverage: {data.coverage}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {err ? <span className="text-amber-400">reconnecting · </span> : null}
          {new Date(data.generated_at).toLocaleTimeString()}
        </span>
      </div>

      <p className="mt-2 text-sm leading-snug">{data.summary}</p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        {data.signals.map(s => (
          <div key={s.symbol} className="flex items-center gap-1.5">
            <span className="font-mono text-muted-foreground">{s.symbol}</span>
            <span className={cn('tabular-nums font-semibold',
              s.pct_24h === null ? 'text-muted-foreground'
              : s.pct_24h > 0    ? 'text-emerald-400'
              : s.pct_24h < 0    ? 'text-rose-400' : '')}>
              {pct(s.pct_24h)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
