/**
 * Execution Monitor — institutional OMS/EMS observability view.
 *
 * Sits alongside the existing /execution (Mirror Chart) at
 * /execution/monitor. The Mirror Chart shows the trader the price + their
 * fills overlaid; this page shows the OPERATIONAL pipeline beneath:
 * per-broker latency, retries, dead-lettered jobs, recent fills with full
 * trace correlation.
 *
 * Data sources (all RLS-scoped to the user):
 *   • copy_jobs           timing + status + attempts + trace
 *   • execution_events    immutable fill ledger (ORDER_FILLED / POSITION_CLOSED)
 *   • copy_jobs_dlq       dead-letters + replay state
 *   • copy_reconciliation open desync items
 *
 * Server component, parallel-fetched. Designed to plug into WebSocket
 * later without panel surgery — same shapes, just live tick.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Database } from '@/lib/supabase/database.types'

type Kill   = Database['public']['Tables']['global_risk_state']['Row']
type Job    = Database['public']['Tables']['copy_jobs']['Row']
type Fill   = Database['public']['Tables']['execution_events']['Row']
type Dlq    = Database['public']['Tables']['copy_jobs_dlq']['Row']
type Recon  = Database['public']['Tables']['copy_reconciliation']['Row']
type LatRow = Pick<Job, 'broker' | 'created_at' | 'filled_at' | 'status'>

export const dynamic = 'force-dynamic'

const fmtTime = (v: unknown) => {
  if (typeof v !== 'string') return '—'
  try { return new Date(v).toLocaleString() } catch { return v }
}
const fmtTimeShort = (v: unknown) => {
  if (typeof v !== 'string') return '—'
  try { return new Date(v).toLocaleTimeString() } catch { return v }
}
const fmtNum = (v: unknown, dp = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—'

function statusClass(s: string): string {
  if (s === 'filled' || s === 'partial')    return 'text-emerald-500'
  if (s === 'queued' || s === 'claimed')    return 'text-blue-400'
  if (s === 'rejected' || s === 'skipped')  return 'text-amber-500'
  if (s === 'failed')                       return 'text-red-500'
  return 'text-gray-400'
}
function latencyBand(ms: number): { cls: string; label: string } {
  if (ms < 1000)  return { cls: 'text-emerald-500', label: 'fast' }
  if (ms < 5000)  return { cls: 'text-blue-400',    label: 'ok' }
  if (ms < 15000) return { cls: 'text-amber-500',   label: 'slow' }
  return            { cls: 'text-red-500',     label: 'very slow' }
}

export default async function ExecutionMonitorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 24-hour window for "recent" stats; trim where useful.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [killRes, jobsRes, fillsRes, dlqRes, reconRes, latencyRes] = await Promise.all([
    supabase.from('global_risk_state').select('kill_switch').eq('id', true).maybeSingle(),
    supabase.from('copy_jobs')
      .select('id, trace_id, kind, status, attempts, broker, computed_lot, ' +
              'risk_reason, last_error, created_at, filled_at, copy_trade_id')
      .eq('follower_id', user.id)
      .order('created_at', { ascending: false }).limit(40),
    supabase.from('execution_events')
      .select('id, broker, event_type, payload, trace_id, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since24h)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('copy_jobs_dlq')
      .select('id, original_job_id, broker, failure_category, attempts, ' +
              'last_error, trace_id, replayed_at, created_at')
      .eq('follower_id', user.id)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('copy_reconciliation')
      .select('id, kind, severity, expected, observed, detected_at')
      .eq('follower_id', user.id).is('resolved_at', null)
      .order('detected_at', { ascending: false }).limit(10),
    // For per-broker latency, pull every recent filled job and compute
    // (filled_at - created_at) in Python below.
    supabase.from('copy_jobs')
      .select('broker, created_at, filled_at, status')
      .eq('follower_id', user.id)
      .in('status', ['filled', 'partial'])
      .not('filled_at', 'is', null)
      .gte('created_at', since24h)
      .limit(500),
  ])

  const kill  = (killRes.data    ?? null) as Kill | null
  const jobs  = (jobsRes.data    ?? []) as unknown as Job[]
  const fills = (fillsRes.data   ?? []) as unknown as Fill[]
  const dlq   = (dlqRes.data     ?? []) as unknown as Dlq[]
  const recon = (reconRes.data   ?? []) as unknown as Recon[]
  const lat   = (latencyRes.data ?? []) as unknown as LatRow[]

  // ── Per-broker latency aggregation ───────────────────────────────
  type BrokerStats = {
    broker: string; count: number; min_ms: number; max_ms: number
    p50_ms: number; p95_ms: number; avg_ms: number
  }
  const groups = new Map<string, number[]>()
  for (const r of lat) {
    if (!r.filled_at) continue              // query filters not-null, but TS doesn't know
    const broker = r.broker || 'unknown'
    const ms = new Date(r.filled_at).getTime() - new Date(r.created_at).getTime()
    if (!Number.isFinite(ms) || ms < 0) continue
    if (!groups.has(broker)) groups.set(broker, [])
    groups.get(broker)!.push(ms)
  }
  const brokerStats: BrokerStats[] = Array.from(groups.entries())
    .filter(([, arr]) => arr.length > 0)
    .map(([broker, arr]) => {
      arr.sort((a, b) => a - b)
      const n = arr.length
      const sum = arr.reduce((a, b) => a + b, 0)
      return {
        broker, count: n,
        min_ms: arr[0]!,                                       // n>0 guaranteed
        max_ms: arr[n - 1]!,
        p50_ms: arr[Math.floor((n - 1) * 0.5)]!,
        p95_ms: arr[Math.floor((n - 1) * 0.95)]!,
        avg_ms: Math.round(sum / n),
      }
    })
    .sort((a, b) => b.count - a.count)

  // ── KPIs ─────────────────────────────────────────────────────────
  const fillsToday = fills.filter(f => f.event_type === 'ORDER_FILLED').length
  const closesToday = fills.filter(f => f.event_type === 'POSITION_CLOSED').length
  const retriedJobs = jobs.filter(j => (j.attempts ?? 0) > 1).length
  const failedJobs  = jobs.filter(j => j.status === 'failed').length
  const latFilled = lat.filter((r): r is LatRow & { filled_at: string } => !!r.filled_at)
  const overallAvgLatency = latFilled.length > 0
    ? Math.round(
        latFilled.reduce((a, r) =>
          a + (new Date(r.filled_at).getTime() - new Date(r.created_at).getTime()), 0)
        / latFilled.length,
      )
    : null

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      {/* Mini system bar */}
      <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs ${
        kill?.kill_switch
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-emerald-500/20 bg-emerald-500/[0.02]'
      }`}>
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${kill?.kill_switch ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
          {kill?.kill_switch
            ? <span className="text-red-500 font-medium">Kill switch ACTIVE — execution halted</span>
            : <span className="text-muted-foreground">Execution armed</span>}
        </span>
        <div className="flex items-center gap-4">
          <Link href="/execution" className="text-blue-400 hover:underline">Mirror Chart →</Link>
          <Link href="/command" className="text-blue-400 hover:underline">Command →</Link>
        </div>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Execution Monitor</h1>
        <p className="text-xs text-muted-foreground">
          OMS/EMS-style observability for the copy pipeline. 24h rolling window.
        </p>
      </header>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Fills (24h)"  value={String(fillsToday)} cls="text-emerald-500" />
        <Kpi label="Closes (24h)" value={String(closesToday)} />
        <Kpi label="Retried jobs" value={String(retriedJobs)}
             cls={retriedJobs > 5 ? 'text-amber-500' : ''} />
        <Kpi label="Failed jobs"  value={String(failedJobs)}
             cls={failedJobs > 0 ? 'text-red-500' : 'text-muted-foreground'} />
        <Kpi label="Avg latency"
             value={overallAvgLatency !== null ? `${overallAvgLatency}ms` : '—'}
             cls={overallAvgLatency !== null ? latencyBand(overallAvgLatency).cls : ''} />
      </div>

      {/* ── Per-broker latency table ─────────────────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-medium">Per-broker latency</h2>
          <span className="text-[11px] text-muted-foreground">
            signal claim → fill, last 24h
          </span>
        </div>
        {brokerStats.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No filled jobs in the last 24h.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Broker</th>
                  <th className="p-2 text-right">Fills</th>
                  <th className="p-2 text-right">Avg</th>
                  <th className="p-2 text-right">p50</th>
                  <th className="p-2 text-right">p95</th>
                  <th className="p-2 text-right">Min</th>
                  <th className="p-2 text-right">Max</th>
                  <th className="p-2">Band</th>
                </tr>
              </thead>
              <tbody>
                {brokerStats.map(s => {
                  const band = latencyBand(s.p95_ms)
                  return (
                    <tr key={s.broker} className="border-b last:border-0">
                      <td className="p-2 font-mono font-medium">{s.broker}</td>
                      <td className="p-2 text-right tabular-nums">{s.count}</td>
                      <td className="p-2 text-right tabular-nums">{s.avg_ms}ms</td>
                      <td className="p-2 text-right tabular-nums">{s.p50_ms}ms</td>
                      <td className={`p-2 text-right tabular-nums ${band.cls}`}>{s.p95_ms}ms</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">{s.min_ms}ms</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground">{s.max_ms}ms</td>
                      <td className={`p-2 ${band.cls}`}>{band.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Recent fills timeline + Recent jobs (side by side) ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Fills timeline</h2>
            <span className="text-[11px] text-muted-foreground">
              execution_events, last 24h
            </span>
          </div>
          {fills.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No execution events yet. Once your subscriptions receive signals,
              the orchestrator → executor → broker chain writes them here.
            </p>
          ) : (
            <ul className="space-y-1">
              {fills.map(f => {
                const p = (f.payload ?? {}) as Record<string, unknown>
                const isFill   = f.event_type === 'ORDER_FILLED'
                const isClose  = f.event_type === 'POSITION_CLOSED'
                const dot = isFill ? 'bg-emerald-500' : isClose ? 'bg-blue-500' : 'bg-gray-500'
                return (
                  <li key={f.id} className="flex items-center gap-2 rounded border bg-background/30 px-2 py-1.5 text-xs">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {fmtTimeShort(f.created_at)}
                    </span>
                    <span className="font-mono text-[10px]">{f.broker}</span>
                    <span className="font-medium uppercase text-[10px] text-muted-foreground">{f.event_type}</span>
                    <span className="font-mono">{String(p.symbol ?? '—')}</span>
                    <span className={String(p.side) === 'buy' ? 'text-emerald-500' : 'text-red-500'}>
                      {String(p.side ?? '')}
                    </span>
                    <span className="tabular-nums">
                      {typeof p.filled_qty === 'number' ? p.filled_qty :
                       typeof p.qty === 'number' ? p.qty : ''}
                    </span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                      @ {fmtNum(p.avg_fill_price ?? p.price, 5)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {(f.trace_id as string)?.slice(0, 8) ?? ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Recent jobs</h2>
            <span className="text-[11px] text-muted-foreground">
              copy_jobs · all statuses
            </span>
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b bg-card text-left text-muted-foreground">
                <tr>
                  <th className="p-1.5">When</th>
                  <th className="p-1.5">Kind</th>
                  <th className="p-1.5">Status</th>
                  <th className="p-1.5">Brk</th>
                  <th className="p-1.5 text-right">Att</th>
                  <th className="p-1.5">Trace</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr><td colSpan={6} className="p-2 text-muted-foreground">No jobs yet.</td></tr>
                ) : jobs.map(j => (
                  <tr key={j.id} className="border-b last:border-0">
                    <td className="p-1.5 text-muted-foreground tabular-nums">{fmtTimeShort(j.created_at)}</td>
                    <td className="p-1.5 font-mono">{j.kind}</td>
                    <td className={`p-1.5 font-medium ${statusClass(j.status)}`}>{j.status}</td>
                    <td className="p-1.5 font-mono">{j.broker ?? '—'}</td>
                    <td className={`p-1.5 text-right tabular-nums ${(j.attempts ?? 0) > 1 ? 'text-amber-500' : ''}`}>
                      {j.attempts ?? 0}
                    </td>
                    <td className="p-1.5 font-mono text-[10px] text-muted-foreground">
                      {(j.trace_id as string)?.slice(0, 8) ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── DLQ + Recon (side by side) ────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Dead-letter queue</h2>
            <span className="text-[11px] text-muted-foreground">
              latest 20 · admins replay via <Link href="/admin/ops" className="text-blue-400 hover:underline">Ops</Link>
            </span>
          </div>
          {dlq.length === 0 ? (
            <p className="text-xs text-muted-foreground">No dead-lettered jobs. ✓</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="p-1.5">When</th>
                    <th className="p-1.5">Category</th>
                    <th className="p-1.5">Broker</th>
                    <th className="p-1.5">Replayed</th>
                    <th className="p-1.5">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {dlq.map(d => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="p-1.5 text-muted-foreground">{fmtTime(d.created_at)}</td>
                      <td className="p-1.5"><code className="font-mono">{d.failure_category}</code></td>
                      <td className="p-1.5 font-mono">{d.broker ?? '—'}</td>
                      <td className={`p-1.5 ${d.replayed_at ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {d.replayed_at ? '✓' : 'pending'}
                      </td>
                      <td className="p-1.5 text-muted-foreground">
                        {((d.last_error as string) ?? '').slice(0, 60)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Open reconciliation</h2>
            <span className="text-[11px] text-muted-foreground">
              broker ≠ copy_trades divergences
            </span>
          </div>
          {recon.length === 0 ? (
            <p className="text-xs text-muted-foreground">In sync with broker positions. ✓</p>
          ) : (
            <ul className="space-y-1.5">
              {recon.map(r => {
                const cls = r.severity === 'critical' ? 'border-red-500/30 text-red-500'
                  : r.severity === 'warn' ? 'border-amber-500/30 text-amber-500'
                  : 'border-blue-500/30 text-blue-500'
                return (
                  <li key={r.id} className={`rounded border bg-background/30 px-2 py-1.5 text-xs ${cls}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-medium">{r.kind}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtTime(r.detected_at)}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      observed: {JSON.stringify(r.observed ?? {}).slice(0, 80)}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

function Kpi({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums leading-none ${cls}`}>{value}</div>
    </div>
  )
}
