/**
 * Copy Insights — the user's window into what the new event-driven copy
 * pipeline + AI coach are actually doing for them.
 *
 * Server component, RLS-scoped: every read goes through the user's JWT so
 * users see only their own rows. Three panels render in parallel:
 *   • Coach scorecard (discipline + open behavioral alerts)
 *   • Performance analytics (win rate / PF / expectancy / best-worst)
 *   • Recent copy jobs (trace-id, allocation, fill or rejection reason)
 *
 * Empty states are explicit ("nothing yet — workers will fill this in")
 * — better than blank panels that look broken.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Database } from '@/lib/supabase/database.types'

type CoachState   = Database['public']['Tables']['coach_state']['Row']
type CoachAlert   = Database['public']['Tables']['coach_alerts']['Row']
type Analytics    = Database['public']['Tables']['journal_analytics']['Row']
type CopyJob      = Database['public']['Tables']['copy_jobs']['Row']

export const dynamic = 'force-dynamic'

// ── tiny formatting helpers (no external lib) ──────────────────────────
const fmtNum  = (v: unknown, dp = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—'
const fmtPct  = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'
const fmtTime = (v: unknown) => {
  if (typeof v !== 'string') return '—'
  try { return new Date(v).toLocaleString() } catch { return v }
}

function scoreClass(score: number | null | undefined): string {
  if (typeof score !== 'number') return 'text-gray-400'
  if (score >= 85) return 'text-emerald-500'
  if (score >= 70) return 'text-blue-500'
  if (score >= 50) return 'text-amber-500'
  return 'text-red-500'
}

function statusClass(s: string): string {
  if (s === 'filled' || s === 'partial')    return 'text-emerald-500'
  if (s === 'queued' || s === 'claimed')    return 'text-blue-400'
  if (s === 'rejected' || s === 'skipped')  return 'text-amber-500'
  if (s === 'failed')                       return 'text-red-500'
  return 'text-gray-400'
}

export default async function CopyInsightsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Parallel fetch — three independent queries, all RLS-scoped to this user.
  const [stateRes, alertsRes, analyticsRes, jobsRes] = await Promise.all([
    supabase.from('coach_state')
      .select('discipline_score, win_rate, win_rate_after_losses, ' +
              'current_loss_streak, revenge_events, oversize_events, ' +
              'sizing_cv, trades, window_days, computed_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('coach_alerts')
      .select('id, kind, severity, title, created_at')
      .eq('user_id', user.id).eq('acknowledged', false)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('journal_analytics')
      .select('trades, win_rate, profit_factor, expectancy, net_pnl, ' +
              'max_drawdown, reward_risk, best_pair, worst_pair, ' +
              'best_session, computed_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('copy_jobs')
      .select('id, trace_id, kind, status, computed_lot, risk_reason, ' +
              'last_error, created_at, filled_at')
      .eq('follower_id', user.id)
      .order('created_at', { ascending: false }).limit(15),
  ])

  // Typed via opt-in Database aliases (see lib/supabase/server.ts on why
  // the global client isn't generic-bound in this SDK version).
  // unknown-step required for array casts (untyped client returns
  // GenericStringError shape; types overlap insufficiently otherwise).
  const state     = (stateRes.data ?? null)     as CoachState | null
  const alerts    = (alertsRes.data ?? []) as unknown as CoachAlert[]
  const analytics = (analyticsRes.data ?? null) as Analytics | null
  const jobs      = (jobsRes.data ?? []) as unknown as CopyJob[]

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Copy Insights</h1>
        <p className="text-sm text-muted-foreground">
          Live view of your copy pipeline, AI coach, and performance.
        </p>
      </header>

      {/* ── Coach scorecard ──────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">AI Trading Coach</h2>
        {!state ? (
          <p className="text-sm text-muted-foreground">
            No discipline score yet — the coach needs at least 5 realized trades.
            Once you have history, this updates every ~5 min.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Discipline"
                  value={typeof state.discipline_score === 'number'
                    ? state.discipline_score.toFixed(1) : '—'}
                  valueClass={scoreClass(state.discipline_score as number | null)} />
            <Stat label="Win rate"          value={fmtPct(state.win_rate)} />
            <Stat label="After 2+ losses"   value={fmtPct(state.win_rate_after_losses)} />
            <Stat label="Trades (window)"   value={`${state.trades ?? 0} / ${state.window_days ?? 30}d`} />
            <Stat label="Loss streak"       value={String(state.current_loss_streak ?? 0)} />
            <Stat label="Revenge events"    value={String(state.revenge_events ?? 0)} />
            <Stat label="Oversize events"   value={String(state.oversize_events ?? 0)} />
            <Stat label="Sizing CV"
                  value={typeof state.sizing_cv === 'number'
                    ? state.sizing_cv.toFixed(2) : '—'} />
          </div>
        )}

        {alerts.length > 0 && (
          <div className="mt-5 space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Open alerts</h3>
            <ul className="space-y-1">
              {alerts.map(a => (
                <li key={a.id as string} className="flex items-center gap-2 text-sm">
                  <Pill severity={a.severity as string} />
                  <span className="font-medium">{a.title as string}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtTime(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Performance analytics ────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">Performance Scorecard</h2>
        {!analytics ? (
          <p className="text-sm text-muted-foreground">
            No analytics yet — once you have realized trades the coach will
            compute win rate, profit factor, expectancy, and best/worst breakdowns.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Trades"        value={String(analytics.trades ?? 0)} />
            <Stat label="Win rate"      value={fmtPct(analytics.win_rate)} />
            <Stat label="Profit factor" value={fmtNum(analytics.profit_factor, 2)} />
            <Stat label="Expectancy"    value={`$${fmtNum(analytics.expectancy, 2)}`} />
            <Stat label="Net PnL"       value={`$${fmtNum(analytics.net_pnl, 2)}`} />
            <Stat label="Max drawdown"  value={`$${fmtNum(analytics.max_drawdown, 2)}`} />
            <Stat label="Reward/risk"   value={fmtNum(analytics.reward_risk, 2)} />
            <Stat label="Best pair"     value={(analytics.best_pair as string) ?? '—'} />
          </div>
        )}
      </section>

      {/* ── Recent copy jobs ──────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">Recent Copy Jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No copy jobs yet — once a strategy you're subscribed to publishes a
            signal, the orchestrator fans it out here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
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
                {jobs.map(j => (
                  <tr key={j.id as string} className="border-b last:border-0">
                    <td className="p-2 text-muted-foreground">{fmtTime(j.created_at)}</td>
                    <td className="p-2">{j.kind as string}</td>
                    <td className={`p-2 font-medium ${statusClass(j.status as string)}`}>
                      {j.status as string}
                    </td>
                    <td className="p-2 text-right">
                      {typeof j.computed_lot === 'number' ? j.computed_lot.toFixed(2) : '—'}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {((j.risk_reason ?? j.last_error) as string)?.slice(0, 80) || ''}
                    </td>
                    <td className="p-2 font-mono text-[10px] text-muted-foreground">
                      {(j.trace_id as string)?.slice(0, 8) ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function Stat({ label, value, valueClass = '' }: {
  label: string; value: string; valueClass?: string
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  )
}

function Pill({ severity }: { severity: string }) {
  const cls = severity === 'critical'
    ? 'bg-red-500/15 text-red-500 border-red-500/30'
    : severity === 'warn'
    ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    : 'bg-blue-500/15 text-blue-500 border-blue-500/30'
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${cls}`}>
      {severity}
    </span>
  )
}
