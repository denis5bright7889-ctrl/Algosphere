'use client'
/**
 * OpsClient — interactive layer for the Admin Ops page.
 *
 * Server component fetches initial snapshot; this drives mutations
 * (kill-switch toggle, DLQ replay) and triggers router.refresh() to re-read
 * the SSR view. No client-side state cache — the page is the cache, and
 * refresh keeps it honest.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Initial = {
  kill: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dlq: any[]
  dlqStats: { total: number; open: number; replayed: number; openByCat: Record<string, number> }
  workers: { id: string; claims: number; last: string; ageS: number; status: string }[]
  queue: { queued: number; failed: number }
  adminEmail: string | null | undefined
}

const fmtTime = (v: string | null | undefined) => {
  if (!v) return '—'
  try { return new Date(v).toLocaleString() } catch { return v }
}

export default function OpsClient({ initial }: { initial: Initial }) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const killActive = Boolean(initial.kill?.kill_switch)

  async function toggleKill(activate: boolean) {
    setErr(null)
    if (activate && !reason.trim()) {
      setErr('Please type a short reason before activating the kill switch.')
      return
    }
    const res = await fetch('/api/admin/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: activate, reason: activate ? reason.trim() : undefined }),
    })
    if (!res.ok) { setErr((await res.json()).error ?? 'kill-switch request failed'); return }
    setConfirming(false); setReason('')
    startTransition(() => router.refresh())
  }

  async function replay(id: string) {
    setErr(null)
    const res = await fetch(`/api/admin/dlq/${id}/replay`, { method: 'POST' })
    if (!res.ok) { setErr((await res.json()).error ?? 'replay failed'); return }
    startTransition(() => router.refresh())
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin Ops</h1>
          <p className="text-xs text-muted-foreground">
            Break-glass tooling. Signed in as <code>{initial.adminEmail}</code>.
          </p>
        </div>
        <button onClick={() => startTransition(() => router.refresh())}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {err && (
        <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          {err}
        </div>
      )}

      {/* ── Kill switch ───────────────────────────────────────── */}
      <section className={`rounded-xl border p-4 ${killActive ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/[0.02]'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${killActive ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
              <h2 className="text-lg font-medium">
                Global kill switch — {killActive ? 'ACTIVE' : 'off'}
              </h2>
            </div>
            {killActive ? (
              <p className="mt-1 text-xs text-red-400">
                {initial.kill.reason ?? 'halted'} · by {initial.kill.activated_by ?? '?'} · {fmtTime(initial.kill.activated_at)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Execution armed. Reduce-only orders are always permitted (so positions can flatten during a halt).
              </p>
            )}
          </div>

          {!killActive && !confirming && (
            <button onClick={() => setConfirming(true)} disabled={busy}
                    className="rounded bg-red-500/10 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/20 disabled:opacity-50">
              Activate kill switch
            </button>
          )}
          {killActive && (
            <button onClick={() => toggleKill(false)} disabled={busy}
                    className="rounded bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-50">
              {busy ? 'Clearing…' : 'Clear / Resume execution'}
            </button>
          )}
        </div>

        {confirming && !killActive && (
          <div className="mt-4 space-y-2 rounded border border-red-500/30 bg-background/40 p-3">
            <label className="block text-xs text-muted-foreground">
              Reason (recorded in audit_logs)
            </label>
            <input value={reason} onChange={e => setReason(e.target.value)}
                   placeholder="e.g. broker outage, runaway leader, market halt"
                   className="w-full rounded border bg-background px-2 py-1 text-sm" />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setConfirming(false); setReason(''); setErr(null) }}
                      className="rounded border px-3 py-1.5 text-xs hover:bg-accent">
                Cancel
              </button>
              <button onClick={() => toggleKill(true)} disabled={busy || !reason.trim()}
                      className="rounded bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/25 disabled:opacity-50">
                {busy ? 'Activating…' : 'Confirm — halt all new exposure'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Workers liveness + queue posture ──────────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-medium">Workers</h2>
          <span className="text-[11px] text-muted-foreground">
            derived from copy_jobs.claimed_by (last 1h); canonical view = Prometheus / Grafana
          </span>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Kpi label="Queued" value={String(initial.queue.queued)} cls={initial.queue.queued > 500 ? 'text-amber-500' : ''} />
          <Kpi label="Failed (terminal)" value={String(initial.queue.failed)} cls={initial.queue.failed > 0 ? 'text-red-500' : 'text-muted-foreground'} />
          <Kpi label="Active executors" value={String(initial.workers.filter(w => w.status === 'active').length)} />
        </div>
        {initial.workers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No worker activity in the last hour.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Worker</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Claims (1h)</th>
                  <th className="p-2">Last claim</th>
                  <th className="p-2 text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {initial.workers.map(w => (
                  <tr key={w.id} className="border-b last:border-0">
                    <td className="p-2 font-mono">{w.id}</td>
                    <td className={`p-2 font-medium ${w.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {w.status}
                    </td>
                    <td className="p-2 text-right tabular-nums">{w.claims}</td>
                    <td className="p-2 text-muted-foreground">{fmtTime(w.last)}</td>
                    <td className="p-2 text-right text-muted-foreground tabular-nums">{w.ageS}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── DLQ ───────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-medium">Dead-letter queue</h2>
          <span className="text-[11px] text-muted-foreground">
            total {initial.dlqStats.total} · open {initial.dlqStats.open} · replayed {initial.dlqStats.replayed}
          </span>
        </div>
        {initial.dlqStats.open === 0 ? (
          <p className="text-xs text-muted-foreground">No open dead-lettered jobs. ✓</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(initial.dlqStats.openByCat).map(([cat, n]) => (
                <span key={cat} className="rounded border bg-background/40 px-2 py-1 text-[11px]">
                  <code className="font-mono">{cat}</code> · {n}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-xs">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">When</th>
                    <th className="p-2">Category</th>
                    <th className="p-2 text-right">Attempts</th>
                    <th className="p-2">Broker</th>
                    <th className="p-2">Trace</th>
                    <th className="p-2">Last error</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {initial.dlq.map(d => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="p-2 text-muted-foreground">{fmtTime(d.created_at)}</td>
                      <td className="p-2"><code className="font-mono">{d.failure_category}</code></td>
                      <td className="p-2 text-right tabular-nums">{d.attempts}</td>
                      <td className="p-2">{d.broker ?? '—'}</td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground">
                        {(d.trace_id as string)?.slice(0, 8) ?? ''}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {((d.last_error as string) ?? '').slice(0, 80)}
                      </td>
                      <td className="p-2 text-right">
                        <button onClick={() => replay(d.id)} disabled={busy}
                                className="rounded border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50">
                          Replay
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function Kpi({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}
