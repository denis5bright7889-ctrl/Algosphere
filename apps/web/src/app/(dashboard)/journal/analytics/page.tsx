/**
 * Journal Analytics — Tradezella-grade performance scorecard.
 *
 * Sits alongside the existing manual-entry /journal as a read-only,
 * pre-aggregated view. All data comes from journal_analytics (computed by
 * the coach worker every ~5 min from the user's realized journal_entries —
 * which the migration-029 trigger auto-populates from execution_events).
 *
 * Four breakdowns rendered as compact heatmap-style tables:
 *   by_session   when do you make money?
 *   by_pair      what do you trade well?
 *   by_tag       which setups work?
 *   by_hour      what time of day?
 *
 * Plus a 'recent auto-journaled trades' table reading journal_entries
 * directly so the user can see the trigger working end-to-end.
 *
 * Server component, RLS-scoped, parallel-fetched. No client JS needed.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const fmtUsd = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v)
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'
const fmtNum = (v: unknown, dp = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—'
const fmtPct = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'
const fmtTime = (v: unknown) => {
  if (typeof v !== 'string') return '—'
  try { return new Date(v).toLocaleString() } catch { return v }
}
function pnlBgClass(pnl: number, max: number): string {
  if (max <= 0) return 'bg-background/40'
  const intensity = Math.min(1, Math.abs(pnl) / max)
  if (pnl > 0) {
    if (intensity > 0.7) return 'bg-emerald-500/30 border-emerald-500/40'
    if (intensity > 0.3) return 'bg-emerald-500/15 border-emerald-500/25'
    return 'bg-emerald-500/5 border-emerald-500/15'
  }
  if (pnl < 0) {
    if (intensity > 0.7) return 'bg-red-500/30 border-red-500/40'
    if (intensity > 0.3) return 'bg-red-500/15 border-red-500/25'
    return 'bg-red-500/5 border-red-500/15'
  }
  return 'bg-background/40 border-transparent'
}
function pnlTextClass(pnl: number): string {
  if (pnl > 0) return 'text-emerald-500'
  if (pnl < 0) return 'text-red-500'
  return 'text-muted-foreground'
}

// Each bucket entry from journal_analytics has shape {trades, win_rate, pnl}.
type Bucket = { trades: number; win_rate: number; pnl: number }
function bucketsFromJson(raw: unknown): [string, Bucket][] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw as Record<string, Bucket>)
}

export default async function JournalAnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [analyticsRes, entriesRes] = await Promise.all([
    supabase.from('journal_analytics').select('*')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('journal_entries')
      .select('id, pair, direction, entry_price, exit_price, lot_size, ' +
              'pnl, duration_ms, source, ai_tags, session, created_at')
      .eq('user_id', user.id)
      .not('pnl', 'is', null)
      .order('created_at', { ascending: false }).limit(20),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = (analyticsRes.data ?? null) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = (entriesRes.data ?? []) as any[]

  const bySession = bucketsFromJson(a?.by_session).sort((x, y) => y[1].pnl - x[1].pnl)
  const byPair    = bucketsFromJson(a?.by_pair).sort((x, y) => y[1].pnl - x[1].pnl).slice(0, 10)
  const byTag     = bucketsFromJson(a?.by_tag).sort((x, y) => y[1].pnl - x[1].pnl).slice(0, 10)
  const byHour    = Array.from({ length: 24 }, (_, h) => {
    const key = `${h.toString().padStart(2, '0')}`
    const raw = (a?.by_hour ?? {})[key] as Bucket | undefined
    return [key, raw ?? { trades: 0, win_rate: 0, pnl: 0 }] as [string, Bucket]
  })
  const maxPnl = Math.max(
    1,
    ...bySession.map(([, b]) => Math.abs(b.pnl)),
    ...byPair.map(([, b]) => Math.abs(b.pnl)),
    ...byTag.map(([, b]) => Math.abs(b.pnl)),
    ...byHour.map(([, b]) => Math.abs(b.pnl)),
  )

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal Analytics</h1>
          <p className="text-xs text-muted-foreground">
            Pre-aggregated by the coach worker. Updates every ~5 min.{' '}
            <Link href="/journal" className="text-blue-400 hover:underline">Manual journal →</Link>
          </p>
        </div>
        {a?.computed_at && (
          <span className="text-[11px] text-muted-foreground">
            last computed {fmtTime(a.computed_at)}
          </span>
        )}
      </header>

      {!a ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No analytics yet. The coach worker scores users with ≥1 realized
          journal entry; once your auto-journal (or manual entries) have closed
          P&L, this page populates within ~5 min.
        </div>
      ) : (
        <>
          {/* ── KPI strip ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
            <Kpi label="Trades"        value={String(a.trades ?? 0)} />
            <Kpi label="Win rate"      value={fmtPct(a.win_rate)} />
            <Kpi label="Profit factor" value={fmtNum(a.profit_factor, 2)}
                 cls={typeof a.profit_factor === 'number' && a.profit_factor >= 1.5 ? 'text-emerald-500'
                      : typeof a.profit_factor === 'number' && a.profit_factor < 1 ? 'text-red-500' : ''} />
            <Kpi label="Expectancy"    value={fmtUsd(a.expectancy)}
                 cls={pnlTextClass(Number(a.expectancy ?? 0))} />
            <Kpi label="Net P&L"       value={fmtUsd(a.net_pnl)}
                 cls={pnlTextClass(Number(a.net_pnl ?? 0))} />
            <Kpi label="Max drawdown"  value={fmtUsd(a.max_drawdown)}
                 cls="text-amber-500" />
            <Kpi label="Reward/risk"   value={fmtNum(a.reward_risk, 2)} />
            <Kpi label="Window"        value={`${a.window_days ?? 30}d`} />
          </div>

          {/* ── Best/worst pills ─────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Highlights:</span>
            {a.best_pair && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-500">
                Best pair: <code className="font-mono">{a.best_pair}</code>
              </span>
            )}
            {a.worst_pair && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-500">
                Worst pair: <code className="font-mono">{a.worst_pair}</code>
              </span>
            )}
            {a.best_session && (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-blue-500">
                Best session: <code className="font-mono">{a.best_session}</code>
              </span>
            )}
          </div>

          {/* ── Breakdowns (2 cols on md+) ───────────────────────── */}
          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownPanel title="By session" sub="London / NY / Asia / overlap / off-hours"
                            entries={bySession} maxPnl={maxPnl} />
            <BreakdownPanel title="By pair" sub="top 10 by net PnL"
                            entries={byPair} maxPnl={maxPnl} />
            <BreakdownPanel title="By setup tag" sub="from ai_tags + setup_tag"
                            entries={byTag} maxPnl={maxPnl}
                            empty="No tagged trades yet. The AI tagger labels journal rows; tag manually for richer analytics." />
            <HourHeatmap entries={byHour} maxPnl={maxPnl} />
          </div>

          {/* ── Recent realized trades ───────────────────────────── */}
          <section className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-base font-medium">Recent realized trades</h2>
              <span className="text-[11px] text-muted-foreground">
                latest {entries.length} from journal_entries (auto + manual)
              </span>
            </div>
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No realized trades yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-xs">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">When</th>
                      <th className="p-2">Pair</th>
                      <th className="p-2">Side</th>
                      <th className="p-2 text-right">Lot</th>
                      <th className="p-2 text-right">Entry → Exit</th>
                      <th className="p-2 text-right">P&L</th>
                      <th className="p-2">Session</th>
                      <th className="p-2">Tags</th>
                      <th className="p-2">Src</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="p-2 text-muted-foreground">{fmtTime(e.created_at)}</td>
                        <td className="p-2 font-mono">{e.pair ?? '—'}</td>
                        <td className={`p-2 ${e.direction === 'buy' ? 'text-emerald-500' : 'text-red-500'}`}>
                          {e.direction ?? '—'}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {typeof e.lot_size === 'number' ? e.lot_size.toFixed(2) : '—'}
                        </td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {fmtNum(e.entry_price, 5)} → {fmtNum(e.exit_price, 5)}
                        </td>
                        <td className={`p-2 text-right tabular-nums ${pnlTextClass(Number(e.pnl ?? 0))}`}>
                          {fmtUsd(e.pnl)}
                        </td>
                        <td className="p-2 text-muted-foreground">{e.session ?? '—'}</td>
                        <td className="p-2 text-[10px] text-muted-foreground">
                          {(Array.isArray(e.ai_tags) && e.ai_tags.length > 0)
                            ? e.ai_tags.slice(0, 3).join(', ') : ''}
                        </td>
                        <td className="p-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                            e.source === 'auto'
                              ? 'bg-blue-500/15 text-blue-500'
                              : 'bg-gray-500/15 text-gray-400'
                          }`}>
                            {e.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
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

function BreakdownPanel({ title, sub, entries, maxPnl, empty }: {
  title: string; sub: string
  entries: [string, { trades: number; win_rate: number; pnl: number }][]
  maxPnl: number
  empty?: string
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-medium">{title}</h2>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty ?? 'No data yet.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(([key, b]) => (
            <li key={key}
                className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs ${pnlBgClass(b.pnl, maxPnl)}`}>
              <code className="font-mono font-medium">{key}</code>
              <div className="flex items-center gap-4 text-muted-foreground">
                <span className="tabular-nums">{b.trades} trades</span>
                <span className="tabular-nums">{fmtPct(b.win_rate)}</span>
                <span className={`tabular-nums font-medium ${pnlTextClass(b.pnl)}`}>
                  {fmtUsd(b.pnl)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function HourHeatmap({ entries, maxPnl }: {
  entries: [string, { trades: number; win_rate: number; pnl: number }][]
  maxPnl: number
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-medium">By hour of day (UTC)</h2>
        <span className="text-[11px] text-muted-foreground">color = net PnL</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-12">
        {entries.map(([hr, b]) => (
          <div key={hr}
               title={`${hr}:00 — ${b.trades} trades, ${fmtPct(b.win_rate)} win, ${fmtUsd(b.pnl)}`}
               className={`rounded border p-2 text-center text-[10px] ${pnlBgClass(b.pnl, maxPnl)}`}>
            <div className="font-mono font-medium">{hr}</div>
            <div className={`mt-0.5 tabular-nums ${pnlTextClass(b.pnl)}`}>
              {b.trades > 0 ? b.trades : '·'}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
