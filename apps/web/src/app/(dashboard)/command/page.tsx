/**
 * Command Center — the institutional cockpit page.
 *
 * One server-rendered view that aggregates the live state of every system
 * the user owns:
 *   • System bar     — global kill switch, your queue posture, DLQ, quarantines
 *   • Risk           — exposure, concentration, daily PnL, drawdown vs caps
 *   • Copy pipeline  — per-subscription health (fill rate, p95 lag, desync)
 *   • Coach          — discipline + open behavioral alerts
 *   • Open desyncs   — reconciler-flagged divergences (critical first)
 *   • Recent jobs    — copy_jobs trail with trace ids
 *
 * Server component, RLS-scoped: parallel-fetched, no client-side data
 * dependency. Auto-refreshes via Next.js's default revalidation. Mobile-
 * responsive; data-dense without being noisy.
 *
 * Designed to be upgraded to WebSocket streams later (Phase 9) without
 * restructuring the panels — just swap the fetch with a useSubscription.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Database } from '@/lib/supabase/database.types'

type Kill     = Database['public']['Tables']['global_risk_state']['Row']
type Exposure = Database['public']['Tables']['portfolio_exposure']['Row']
type Limits   = Database['public']['Tables']['risk_limits']['Row']
type Health   = Database['public']['Tables']['copy_health']['Row']
type Coach    = Database['public']['Tables']['coach_state']['Row']
type Alert    = Database['public']['Tables']['coach_alerts']['Row']
type Recon    = Database['public']['Tables']['copy_reconciliation']['Row']
type Job      = Database['public']['Tables']['copy_jobs']['Row']

export const dynamic = 'force-dynamic'

const fmtNum  = (v: unknown, dp = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—'
const fmtUsd  = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v)
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'
const fmtPct  = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'
const fmtTime = (v: unknown) => {
  if (typeof v !== 'string') return '—'
  try { return new Date(v).toLocaleString() } catch { return v }
}

function disciplineClass(score: number | null | undefined): string {
  if (typeof score !== 'number') return 'text-gray-400'
  if (score >= 85) return 'text-emerald-500'
  if (score >= 70) return 'text-blue-500'
  if (score >= 50) return 'text-amber-500'
  return 'text-red-500'
}
function pnlClass(v: number | null | undefined): string {
  if (typeof v !== 'number') return 'text-gray-400'
  if (v > 0)  return 'text-emerald-500'
  if (v < 0)  return 'text-red-500'
  return 'text-gray-300'
}
function healthClass(label: string | null | undefined): string {
  switch (label) {
    case 'excellent': return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    case 'good':      return 'bg-blue-500/15 text-blue-500 border-blue-500/30'
    case 'degraded':  return 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    case 'poor':      return 'bg-red-500/15 text-red-500 border-red-500/30'
    default:          return 'bg-gray-500/15 text-gray-400 border-gray-500/30'
  }
}
function severityClass(s: string): string {
  if (s === 'critical') return 'bg-red-500/15 text-red-500 border-red-500/30'
  if (s === 'warn')     return 'bg-amber-500/15 text-amber-500 border-amber-500/30'
  return 'bg-blue-500/15 text-blue-500 border-blue-500/30'
}

export default async function CommandCenterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Eight parallel reads, all RLS-scoped to this user (except the public
  // kill-switch / strategy_risk_state). Worst-case latency ≈ max(any one).
  const [
    killRes, expRes, limRes, healthRes, coachRes, alertsRes, reconRes,
    jobsRes,
  ] = await Promise.all([
    supabase.from('global_risk_state').select('kill_switch, reason, activated_at').eq('id', true).maybeSingle(),
    supabase.from('portfolio_exposure')
      .select('total_notional, open_positions, largest_concentration_pct, ' +
              'daily_realized_pnl, cumulative_realized_pnl, drawdown_usd, ' +
              'by_direction, updated_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('risk_limits')
      .select('enabled, max_total_exposure_usd, max_symbol_concentration_pct, ' +
              'daily_loss_cap_usd, max_drawdown_usd, max_open_positions')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('copy_health')
      .select('subscription_id, leader_id, fill_rate, p95_lag_ms, ' +
              'desync_open, health_score, health_label, updated_at')
      .eq('follower_id', user.id)
      .order('health_score', { ascending: false, nullsFirst: false }).limit(10),
    supabase.from('coach_state')
      .select('discipline_score, win_rate, current_loss_streak, ' +
              'revenge_events, oversize_events, trades, computed_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('coach_alerts')
      .select('id, kind, severity, title, created_at')
      .eq('user_id', user.id).eq('acknowledged', false)
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('copy_reconciliation')
      .select('id, kind, severity, expected, observed, detected_at')
      .eq('follower_id', user.id).is('resolved_at', null)
      .order('severity', { ascending: false })
      .order('detected_at', { ascending: false }).limit(8),
    supabase.from('copy_jobs')
      .select('id, trace_id, kind, status, computed_lot, risk_reason, ' +
              'last_error, created_at, filled_at')
      .eq('follower_id', user.id)
      .order('created_at', { ascending: false }).limit(10),
  ])

  // Typed via opt-in Database aliases (the global client isn't generic-bound
  // in this SDK version — see lib/supabase/server.ts).
  // Step through unknown for array casts (untyped client returns
  // GenericStringError-shape; see lib/supabase/server.ts).
  const kill   = (killRes.data   ?? null) as Kill | null
  const exp    = (expRes.data    ?? null) as Exposure | null
  const lim    = (limRes.data    ?? null) as Limits | null
  const health = (healthRes.data ?? []) as unknown as Health[]
  const coach  = (coachRes.data  ?? null) as Coach | null
  const alerts = (alertsRes.data ?? []) as unknown as Alert[]
  const recon  = (reconRes.data  ?? []) as unknown as Recon[]
  const jobs   = (jobsRes.data   ?? []) as unknown as Job[]

  const totalNotional = Number(exp?.total_notional ?? 0)
  const expCapPct = lim?.max_total_exposure_usd
    ? Math.min(100, Math.round(100 * totalNotional / Number(lim.max_total_exposure_usd)))
    : null
  const dailyPnl = Number(exp?.daily_realized_pnl ?? 0)
  const dailyCap = lim?.daily_loss_cap_usd ? Number(lim.daily_loss_cap_usd) : null
  const ddCapPct = lim?.max_drawdown_usd && exp?.drawdown_usd
    ? Math.min(100, Math.round(100 * Number(exp.drawdown_usd) / Number(lim.max_drawdown_usd)))
    : null

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      {/* ── System status bar ───────────────────────────────────── */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
        kill?.kill_switch ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/[0.02]'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            kill?.kill_switch ? 'bg-red-500/15 text-red-500' : 'bg-emerald-500/15 text-emerald-500'
          }`}>
            <span className={`h-2 w-2 rounded-full ${kill?.kill_switch ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
            {kill?.kill_switch ? 'KILL SWITCH ACTIVE' : 'EXECUTION ARMED'}
          </span>
          {kill?.kill_switch && kill?.reason && (
            <span className="text-xs text-red-400">{kill.reason}</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>signed in as <code className="font-mono">{user.email}</code></span>
          <Link href="/copy/insights" className="text-blue-400 hover:underline">Insights →</Link>
        </div>
      </div>

      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-xs text-muted-foreground">
            Live cockpit. All panels poll the same DB the workers write to.
          </p>
        </div>
      </header>

      {/* ── Top KPIs ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total notional"
             value={fmtUsd(totalNotional)}
             foot={lim?.max_total_exposure_usd ? `/ ${fmtUsd(lim.max_total_exposure_usd)}` : 'no cap'}
             bar={expCapPct} />
        <Kpi label="Open positions"
             value={String(exp?.open_positions ?? 0)}
             foot={lim?.max_open_positions ? `/ ${lim.max_open_positions}` : 'no cap'} />
        <Kpi label="Daily realized P&L"
             value={fmtUsd(dailyPnl)}
             valueClass={pnlClass(dailyPnl)}
             foot={dailyCap ? `loss cap $${dailyCap}` : 'no cap'} />
        <Kpi label="Drawdown"
             value={fmtUsd(exp?.drawdown_usd)}
             foot={lim?.max_drawdown_usd ? `/ ${fmtUsd(lim.max_drawdown_usd)}` : 'no cap'}
             bar={ddCapPct} barClass={(ddCapPct ?? 0) > 80 ? 'bg-red-500' : (ddCapPct ?? 0) > 50 ? 'bg-amber-500' : 'bg-emerald-500'} />
        <Kpi label="Discipline"
             value={typeof coach?.discipline_score === 'number'
               ? coach.discipline_score.toFixed(1) : '—'}
             valueClass={disciplineClass(coach?.discipline_score)}
             foot={coach?.trades ? `${coach.trades} trades` : 'no data'} />
        <Kpi label="Win rate"
             value={fmtPct(coach?.win_rate)}
             foot={coach?.current_loss_streak ? `${coach.current_loss_streak} loss streak` : 'no streak'} />
        <Kpi label="Concentration"
             value={fmtPct(exp?.largest_concentration_pct)}
             foot={lim?.max_symbol_concentration_pct ? `cap ${lim.max_symbol_concentration_pct}%` : 'no cap'} />
        <Kpi label="Open desyncs"
             value={String(recon.length)}
             foot={recon.length > 0 ? 'see reconciliation panel ↓' : 'all in sync'}
             valueClass={recon.length > 0 ? 'text-amber-500' : 'text-emerald-500'} />
      </div>

      {/* ── Copy health + Coach alerts (2 cols on md+) ─────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Copy Health" sub="per subscription, recomputed every ~2 min">
          {health.length === 0 ? (
            <Empty>No active copy subscriptions yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {health.map(h => (
                <li key={h.subscription_id} className="flex items-center justify-between gap-3 rounded border bg-background/40 px-3 py-2 text-xs">
                  <code className="font-mono text-muted-foreground">{(h.subscription_id as string).slice(0, 8)}</code>
                  <span className={`rounded border px-2 py-0.5 font-medium uppercase ${healthClass(h.health_label as string)}`}>
                    {h.health_label ?? 'idle'}
                  </span>
                  <span className="tabular-nums">{typeof h.health_score === 'number' ? h.health_score.toFixed(1) : '—'}</span>
                  <span className="text-muted-foreground">fill {fmtPct((Number(h.fill_rate ?? 0)) * 100)}</span>
                  <span className="text-muted-foreground">p95 {h.p95_lag_ms ?? '—'}ms</span>
                  <span className={h.desync_open > 0 ? 'text-amber-500' : 'text-muted-foreground'}>
                    desync {h.desync_open ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="AI Coach — open alerts" sub={coach?.computed_at ? `last scored ${fmtTime(coach.computed_at)}` : 'awaiting first scoring pass'}>
          {alerts.length === 0 ? (
            <Empty>No open behavioral alerts. {coach ? '✓ disciplined session.' : 'Coach scores once you have ≥5 realized trades.'}</Empty>
          ) : (
            <ul className="space-y-1.5">
              {alerts.map(a => (
                <li key={a.id} className="flex items-center gap-2 rounded border bg-background/40 px-3 py-2 text-xs">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityClass(a.severity)}`}>
                    {a.severity}
                  </span>
                  <span className="font-medium">{a.title}</span>
                  <span className="ml-auto text-muted-foreground">{fmtTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Reconciliation desyncs ─────────────────────────────── */}
      <Panel title="Open reconciliation" sub="copy_reconciliation entries pending resolution">
        {recon.length === 0 ? (
          <Empty>No divergence between intent and broker truth. ✓</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Detected</th>
                  <th className="p-2">Kind</th>
                  <th className="p-2">Severity</th>
                  <th className="p-2">Expected</th>
                  <th className="p-2">Observed</th>
                </tr>
              </thead>
              <tbody>
                {recon.map(r => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 text-muted-foreground">{fmtTime(r.detected_at)}</td>
                    <td className="p-2 font-mono">{r.kind}</td>
                    <td className={`p-2 font-medium ${severityClass(r.severity).split(' ').find(c => c.startsWith('text-'))}`}>
                      {r.severity}
                    </td>
                    <td className="p-2 font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(r.expected ?? {}).slice(0, 60)}
                    </td>
                    <td className="p-2 font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(r.observed ?? {}).slice(0, 60)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Recent copy jobs ───────────────────────────────────── */}
      <Panel title="Recent copy jobs" sub="trace_id is the join key across signal_events / execution_events / journal_entries">
        {jobs.length === 0 ? (
          <Empty>No jobs yet. The orchestrator fans out signal_events into copy_jobs as your subscriptions receive signals.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Kind</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Lot</th>
                  <th className="p-2">Reason / error</th>
                  <th className="p-2">Trace</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const cls = j.status === 'filled' || j.status === 'partial' ? 'text-emerald-500'
                    : j.status === 'queued' || j.status === 'claimed' ? 'text-blue-400'
                    : j.status === 'rejected' || j.status === 'skipped' ? 'text-amber-500'
                    : j.status === 'failed' ? 'text-red-500' : 'text-gray-400'
                  return (
                    <tr key={j.id} className="border-b last:border-0">
                      <td className="p-2 text-muted-foreground">{fmtTime(j.created_at)}</td>
                      <td className="p-2 font-mono">{j.kind}</td>
                      <td className={`p-2 font-medium ${cls}`}>{j.status}</td>
                      <td className="p-2 text-right tabular-nums">
                        {typeof j.computed_lot === 'number' ? j.computed_lot.toFixed(2) : '—'}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {((j.risk_reason ?? j.last_error) as string)?.slice(0, 80) || ''}
                      </td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground">
                        {(j.trace_id as string)?.slice(0, 8) ?? ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  )
}

function Kpi({ label, value, foot, valueClass = '', bar, barClass = 'bg-blue-500' }: {
  label: string; value: string; foot?: string; valueClass?: string
  bar?: number | null; barClass?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums leading-none ${valueClass}`}>{value}</div>
      {foot && <div className="mt-1 text-[11px] text-muted-foreground">{foot}</div>}
      {typeof bar === 'number' && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-background/60">
          <div className={`h-full ${barClass}`} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
    </div>
  )
}

function Panel({ title, sub, children }: {
  title: string; sub?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-medium">{title}</h2>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
