'use client'

/**
 * Signal Pipeline Diagnostics (Phase 1 observability).
 *
 * Real-time admin view over the engine's /diagnostics/full — answers
 * "why are no signals being generated?" at a glance: engine/worker
 * liveness, drought, per-symbol last evaluation + rejection reason,
 * dead/missing symbols, top rejection reasons, signal throughput.
 *
 * 100% real data. On engine-unreachable it renders a RED fault state —
 * never a fabricated green. Polls every 15s.
 */
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SignalDiagnostics } from '@/lib/engine-client'

type Tone = 'green' | 'amber' | 'red' | 'muted'
const DOT: Record<Tone, string> = {
  green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', muted: 'bg-zinc-600',
}
const TEXT: Record<Tone, string> = {
  green: 'text-emerald-300', amber: 'text-amber-300', red: 'text-rose-300', muted: 'text-muted-foreground',
}

function ageStr(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 90) return `${seconds}s`
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
function secsSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 1000))
}

export default function SignalDiagnostics() {
  const [d, setD] = useState<SignalDiagnostics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/signals/diagnostics', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setD(json.diagnostics as SignalDiagnostics)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    } finally {
      setLoading(false)
      setFetchedAt(Date.now())
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [load])

  if (loading && !d) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Loading engine diagnostics…</div>
  }

  // Engine unreachable / misconfigured → RED, no fabrication.
  if (error && !d) {
    return (
      <div className="rounded-xl border border-rose-500/50 bg-rose-500/[0.06] p-5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', DOT.red)} />
          <h2 className="text-sm font-semibold text-rose-200">Engine diagnostics unreachable</h2>
        </div>
        <p className="mt-2 text-xs text-rose-200/80">{error}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Check <code>SIGNAL_ENGINE_URL</code> + <code>ENGINE_API_KEY</code> and that the engine is running.
        </p>
      </div>
    )
  }
  if (!d) return null

  const workerHb = d.heartbeats.find((h) => h.component === 'signal_worker')
  const workerTone: Tone =
    !workerHb ? 'red'
    : workerHb.age_seconds == null ? 'muted'
    : workerHb.age_seconds > 600 ? 'red'
    : workerHb.age_seconds > 180 ? 'amber' : 'green'

  const engineTone: Tone =
    !d.settings.signal_engine_enabled ? 'red'
    : d.drought.in_drought ? 'amber'
    : d.settings.signal_dry_run ? 'amber' : 'green'

  const killed = d.risk_state && (d.risk_state as { kill_switch?: boolean }).kill_switch === true
  const perSymbol = Object.entries(d.per_symbol)
    .sort((a, b) => (secsSince(a[1].last_at) ?? 1e12) - (secsSince(b[1].last_at) ?? 1e12))

  return (
    <div className="space-y-4">
      {/* Header / status banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <Pill tone={engineTone} label={d.settings.signal_engine_enabled ? (d.settings.signal_dry_run ? 'Engine: DRY-RUN' : 'Engine: LIVE') : 'Engine: DISABLED'} />
        <Pill tone={workerTone} label={`Worker ${workerHb ? ageStr(workerHb.age_seconds) : 'no heartbeat'}`} />
        <Pill tone={d.drought.in_drought ? 'red' : 'green'} label={d.drought.in_drought ? `DROUGHT > ${d.drought.drought_hours}h` : 'Signals flowing'} />
        {killed && <Pill tone="red" label="KILL SWITCH ON" />}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {fetchedAt ? `updated ${ageStr(Math.round((Date.now() - fetchedAt) / 1000))} ago` : ''}{error ? ` · last refresh failed: ${error}` : ''} · auto-refresh 15s
        </span>
      </div>

      {/* Throughput + counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Signals 1h" value={d.signal_counts.last_1h} tone={d.signal_counts.last_1h > 0 ? 'green' : 'amber'} />
        <Stat label="Signals 6h" value={d.signal_counts.last_6h} />
        <Stat label="Signals 24h" value={d.signal_counts.last_24h} />
        <Stat label="Last signal" value={ageStr(d.last_signal?.age_seconds)} tone={d.drought.in_drought ? 'red' : 'green'} />
        <Stat label="Executions 24h" value={d.execution_events_24h < 0 ? '—' : d.execution_events_24h} />
        <Stat label="Journal 24h" value={d.journal_entries_24h < 0 ? '—' : d.journal_entries_24h} />
      </div>

      {/* Heartbeats */}
      <Panel title="Component heartbeats" subtitle={d.heartbeat_error ? `read error: ${d.heartbeat_error}` : `${d.heartbeats.length} components`}>
        {d.heartbeats.length === 0 ? (
          <Empty>No heartbeats recorded — the engine may not be running.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {d.heartbeats.map((h) => {
              const tone: Tone = h.age_seconds == null ? 'muted' : h.age_seconds > 600 ? 'red' : h.age_seconds > 180 ? 'amber' : 'green'
              return (
                <div key={h.component} className="rounded-lg border border-border/60 bg-background/40 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', DOT[tone])} />
                    <span className="text-[11px] font-medium">{h.component}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{h.status} · {ageStr(h.age_seconds)} ago</div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* Top rejections */}
      <Panel title="Top rejection reasons (24h)" subtitle="why signals didn't publish">
        {d.top_rejections_24h.length === 0 ? (
          <Empty>No rejections logged in the last 24h.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {d.top_rejections_24h.map((r) => (
              <li key={r.reason} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="font-mono text-amber-200">{r.reason}</span>
                <span className="tabular-nums text-muted-foreground">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Dead / silent symbols */}
      {d.symbols_missing_from_log.length > 0 && (
        <Panel title={`Silent symbols (${d.symbols_missing_from_log.length})`} subtitle="no decision logged in 24h — regime never classified / no bars / scheduler missed">
          <div className="flex flex-wrap gap-1.5">
            {d.symbols_missing_from_log.map((s) => (
              <span key={s} className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-mono text-rose-200">{s}</span>
            ))}
          </div>
        </Panel>
      )}

      {/* Per-symbol last evaluation */}
      <Panel title="Per-symbol last evaluation" subtitle={`${perSymbol.length} symbols active in the decision log (24h)`}>
        {perSymbol.length === 0 ? (
          <Empty>No per-symbol decisions logged in 24h.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-1.5 pr-2">Symbol</th><th className="py-1.5 px-2">Last event</th><th className="py-1.5 px-2">Reason</th><th className="py-1.5 pl-2 text-right">Age</th></tr>
              </thead>
              <tbody>
                {perSymbol.map(([sym, ev]) => {
                  const evTone: Tone = ev.last_event === 'signal_generated' ? 'green' : ev.last_event === 'risk_block' ? 'red' : 'amber'
                  return (
                    <tr key={sym} className="border-t border-border/40">
                      <td className="py-1.5 pr-2 font-mono font-semibold">{sym}</td>
                      <td className={cn('py-1.5 px-2', TEXT[evTone])}>{ev.last_event}</td>
                      <td className="py-1.5 px-2 font-mono text-[11px] text-muted-foreground">{ev.last_reason ?? '—'}</td>
                      <td className="py-1.5 pl-2 text-right tabular-nums text-muted-foreground">{ageStr(secsSince(ev.last_at))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function Pill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
      tone === 'green' ? 'border-emerald-500/40 bg-emerald-500/10' : tone === 'amber' ? 'border-amber-500/40 bg-amber-500/10' : tone === 'red' ? 'border-rose-500/50 bg-rose-500/10' : 'border-border bg-muted/30')}>
      <span className={cn('h-2 w-2 rounded-full', DOT[tone])} />
      <span className={TEXT[tone]}>{label}</span>
    </span>
  )
}

function Stat({ label, value, tone = 'muted' }: { label: string; value: string | number; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums leading-none', TEXT[tone])}>{value}</div>
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>
}
