/**
 * Risk Exposure — portfolio-level institutional risk dashboard.
 *
 * Sits alongside the existing /risk (DailyLossTracker / PositionSizer) at
 * /risk/exposure. All data comes from portfolio_exposure (recomputed by
 * the reconciler every ~2 min) + risk_limits (user-configured caps) +
 * strategy_risk_state (auto-quarantine ledger).
 *
 * Sections:
 *   • Top KPIs — notional / positions / daily PnL / drawdown
 *   • Limit utilization — visual gauges for every cap vs current usage
 *   • By-symbol exposure — top concentrations with proportional bars
 *   • Buy vs sell split — notional balance check
 *   • Quarantined/disabled strategies (auto-quarantine ledger)
 *   • Open desyncs reminder
 *
 * Server component, RLS-scoped, parallel-fetched. The kill switch banner
 * mirrors Command Center so the page stands alone.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const fmtUsd = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v)
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'
const fmtPct = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'
const fmtTime = (v: unknown) => {
  if (typeof v !== 'string') return '—'
  try { return new Date(v).toLocaleString() } catch { return v }
}
function pnlClass(v: number | null | undefined): string {
  if (typeof v !== 'number') return 'text-gray-400'
  if (v > 0)  return 'text-emerald-500'
  if (v < 0)  return 'text-red-500'
  return 'text-gray-300'
}

/** Convert a 0-100 utilization into a color band. */
function gaugeColors(pct: number, inverse = false) {
  // inverse=true → high % is good (e.g. equity remaining); default false → high is bad
  const danger = inverse ? pct < 20 : pct >= 90
  const warn   = inverse ? pct < 50 : pct >= 70
  if (danger) return { bar: 'bg-red-500',     text: 'text-red-500' }
  if (warn)   return { bar: 'bg-amber-500',   text: 'text-amber-500' }
  return       { bar: 'bg-emerald-500', text: 'text-emerald-500' }
}

export default async function RiskExposurePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [killRes, expRes, limRes, quarRes, reconRes] = await Promise.all([
    supabase.from('global_risk_state')
      .select('kill_switch, reason').eq('id', true).maybeSingle(),
    supabase.from('portfolio_exposure')
      .select('total_notional, open_positions, largest_concentration_pct, ' +
              'by_symbol, by_direction, daily_realized_pnl, ' +
              'cumulative_realized_pnl, peak_realized_pnl, drawdown_usd, updated_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('risk_limits')
      .select('enabled, max_total_exposure_usd, max_symbol_concentration_pct, ' +
              'daily_loss_cap_usd, max_drawdown_usd, max_open_positions, updated_at')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('strategy_risk_state')
      .select('strategy_id, status, reason, consecutive_losses, ' +
              'auto_disabled_at, updated_at')
      .neq('status', 'active')
      .order('updated_at', { ascending: false }).limit(20),
    supabase.from('copy_reconciliation').select('id', { head: true, count: 'exact' })
      .eq('follower_id', user.id).is('resolved_at', null),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kill = (killRes.data ?? null) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exp  = (expRes.data  ?? null) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lim  = (limRes.data  ?? null) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quar = (quarRes.data ?? []) as any[]
  const openDesyncs = reconRes.count ?? 0

  // ── Derived ───────────────────────────────────────────────────────
  const totalNotional   = Number(exp?.total_notional ?? 0)
  const openPositions   = Number(exp?.open_positions ?? 0)
  const dailyPnl        = Number(exp?.daily_realized_pnl ?? 0)
  const drawdown        = Number(exp?.drawdown_usd ?? 0)
  const peakPnl         = Number(exp?.peak_realized_pnl ?? 0)
  const cumulativePnl   = Number(exp?.cumulative_realized_pnl ?? 0)
  const largestConc     = Number(exp?.largest_concentration_pct ?? 0)

  const capExposure   = lim?.max_total_exposure_usd       ? Number(lim.max_total_exposure_usd) : null
  const capConc       = lim?.max_symbol_concentration_pct ? Number(lim.max_symbol_concentration_pct) : null
  const capDailyLoss  = lim?.daily_loss_cap_usd           ? Number(lim.daily_loss_cap_usd) : null
  const capDrawdown   = lim?.max_drawdown_usd             ? Number(lim.max_drawdown_usd) : null
  const capPositions  = lim?.max_open_positions           ? Number(lim.max_open_positions) : null

  const utilExposure  = capExposure  ? Math.min(100, (totalNotional / capExposure)  * 100) : null
  const utilConc      = capConc      ? Math.min(100, (largestConc   / capConc)      * 100) : null
  const utilDailyLoss = capDailyLoss && dailyPnl < 0
    ? Math.min(100, (Math.abs(dailyPnl) / capDailyLoss) * 100) : null
  const utilDrawdown  = capDrawdown  ? Math.min(100, (drawdown      / capDrawdown)  * 100) : null
  const utilPositions = capPositions ? Math.min(100, (openPositions / capPositions) * 100) : null

  // ── Symbol breakdown ─────────────────────────────────────────────
  const bySymbolRaw = (exp?.by_symbol ?? {}) as Record<string, number>
  const bySymbol = Object.entries(bySymbolRaw)
    .map(([sym, notional]) => ({
      sym, notional: Number(notional),
      pct: totalNotional > 0 ? (Number(notional) / totalNotional) * 100 : 0,
    }))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 12)

  const byDir = (exp?.by_direction ?? {}) as { buy?: number; sell?: number }
  const buyNot  = Number(byDir.buy ?? 0)
  const sellNot = Number(byDir.sell ?? 0)
  const dirTotal = buyNot + sellNot
  const buyPct  = dirTotal > 0 ? (buyNot  / dirTotal) * 100 : 0
  const sellPct = dirTotal > 0 ? (sellNot / dirTotal) * 100 : 0

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      {/* ── Mini system bar (mirrors Command Center) ──────────── */}
      <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs ${
        kill?.kill_switch
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-emerald-500/20 bg-emerald-500/[0.02]'
      }`}>
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${kill?.kill_switch ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
          {kill?.kill_switch
            ? <span className="text-red-500 font-medium">Kill switch ACTIVE — new exposure blocked, reduce-only flatten allowed</span>
            : <span className="text-muted-foreground">Execution armed</span>}
        </span>
        <Link href="/command" className="text-blue-400 hover:underline">Command →</Link>
      </div>

      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Risk · Portfolio Exposure</h1>
          <p className="text-xs text-muted-foreground">
            Reconciler-maintained snapshot. Updates every ~2 min.{' '}
            <Link href="/risk" className="text-blue-400 hover:underline">Risk calculators →</Link>
          </p>
        </div>
        {exp?.updated_at && (
          <span className="text-[11px] text-muted-foreground">
            snapshot: {fmtTime(exp.updated_at)}
          </span>
        )}
      </header>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Total notional" value={fmtUsd(totalNotional)} />
        <Kpi label="Open positions" value={String(openPositions)} />
        <Kpi label="Daily P&L"      value={fmtUsd(dailyPnl)}      cls={pnlClass(dailyPnl)} />
        <Kpi label="Drawdown"       value={fmtUsd(drawdown)}      cls={drawdown > 0 ? 'text-amber-500' : 'text-muted-foreground'} />
        <Kpi label="Peak realized"  value={fmtUsd(peakPnl)}       cls="text-blue-400" />
        <Kpi label="Cumulative"     value={fmtUsd(cumulativePnl)} cls={pnlClass(cumulativePnl)} />
      </div>

      {/* ── Limit utilization gauges ──────────────────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-medium">Limit utilization</h2>
          <span className="text-[11px] text-muted-foreground">
            {lim ? (lim.enabled ? 'limits ENABLED' : 'limits DISABLED in risk_limits') : 'no risk_limits row — set caps to enforce'}
          </span>
        </div>
        {!lim ? (
          <p className="text-xs text-muted-foreground">
            No risk limits configured. Insert a row into <code className="font-mono">risk_limits</code> for your account to enforce caps.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Gauge label="Total exposure"
                   used={fmtUsd(totalNotional)} cap={fmtUsd(capExposure)}
                   pct={utilExposure} />
            <Gauge label="Largest symbol concentration"
                   used={fmtPct(largestConc)} cap={capConc ? `${capConc}%` : '—'}
                   pct={utilConc} />
            <Gauge label="Daily realized loss"
                   used={dailyPnl < 0 ? fmtUsd(-dailyPnl) : '$0.00'}
                   cap={fmtUsd(capDailyLoss)}
                   pct={utilDailyLoss} />
            <Gauge label="Realized-PnL drawdown"
                   used={fmtUsd(drawdown)} cap={fmtUsd(capDrawdown)}
                   pct={utilDrawdown} />
            <Gauge label="Open positions"
                   used={String(openPositions)} cap={capPositions ? String(capPositions) : '—'}
                   pct={utilPositions} />
            <div className="rounded-lg border bg-background/40 p-3 text-xs text-muted-foreground">
              Limits are enforced in <code className="font-mono">evaluate_portfolio_risk()</code> on every
              copy job before routing. Breaches result in <code className="font-mono">rejected</code> jobs
              with the reason in <code className="font-mono">risk_reason</code>.
            </div>
          </div>
        )}
      </section>

      {/* ── By-symbol exposure + Direction split ──────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-xl border bg-card p-4 md:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Exposure by symbol</h2>
            <span className="text-[11px] text-muted-foreground">top 12 by notional</span>
          </div>
          {bySymbol.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open exposure right now.</p>
          ) : (
            <ul className="space-y-1.5">
              {bySymbol.map(({ sym, notional, pct }) => {
                const over = capConc !== null && pct > capConc
                return (
                  <li key={sym} className="rounded border bg-background/30 px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between">
                      <code className="font-mono font-medium">{sym}</code>
                      <span className={`tabular-nums ${over ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {fmtPct(pct)} · {fmtUsd(notional)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-background/60">
                      <div className={`h-full ${over ? 'bg-red-500' : 'bg-blue-500'}`}
                           style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Direction split</h2>
            <span className="text-[11px] text-muted-foreground">buy vs sell notional</span>
          </div>
          {dirTotal === 0 ? (
            <p className="text-xs text-muted-foreground">No directional exposure.</p>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex h-3 overflow-hidden rounded border">
                <div className="bg-emerald-500" style={{ width: `${buyPct}%` }} title={`buy ${fmtPct(buyPct)}`} />
                <div className="bg-red-500"     style={{ width: `${sellPct}%` }} title={`sell ${fmtPct(sellPct)}`} />
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-500">buy {fmtPct(buyPct)}</span>
                <span className="text-red-500">sell {fmtPct(sellPct)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{fmtUsd(buyNot)}</span>
                <span>{fmtUsd(sellNot)}</span>
              </div>
              {Math.abs(buyPct - sellPct) > 70 && (
                <p className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-500">
                  Directional imbalance &gt; 70% — heavily one-sided book.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Quarantined / disabled strategies + Desync reminder ─ */}
      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-xl border bg-card p-4 md:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-medium">Quarantined / disabled strategies</h2>
            <span className="text-[11px] text-muted-foreground">
              auto-set by the reconciler on realized-loss breach
            </span>
          </div>
          {quar.length === 0 ? (
            <p className="text-xs text-muted-foreground">All strategies active. ✓</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Strategy</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Consecutive losses</th>
                  <th className="p-2">Reason</th>
                  <th className="p-2">Since</th>
                </tr>
              </thead>
              <tbody>
                {quar.map(s => (
                  <tr key={s.strategy_id} className="border-b last:border-0">
                    <td className="p-2 font-mono text-[10px]">{(s.strategy_id as string).slice(0, 12)}</td>
                    <td className={`p-2 font-medium ${
                      s.status === 'disabled' ? 'text-red-500' : 'text-amber-500'
                    }`}>{s.status}</td>
                    <td className="p-2 text-right tabular-nums">{s.consecutive_losses ?? 0}</td>
                    <td className="p-2 text-muted-foreground">{(s.reason as string) ?? '—'}</td>
                    <td className="p-2 text-muted-foreground">{fmtTime(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-base font-medium">Open desyncs</h2>
          <div className={`rounded border p-3 text-sm ${
            openDesyncs > 0
              ? 'border-amber-500/30 bg-amber-500/5 text-amber-500'
              : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500'
          }`}>
            {openDesyncs > 0 ? (
              <>
                <div className="text-2xl font-semibold tabular-nums">{openDesyncs}</div>
                <Link href="/command" className="text-xs underline">
                  See details on Command Center →
                </Link>
              </>
            ) : (
              <span>In sync with all broker positions. ✓</span>
            )}
          </div>
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

function Gauge({ label, used, cap, pct }: {
  label: string; used: string; cap: string
  pct: number | null
}) {
  const cls = pct === null ? gaugeColors(0) : gaugeColors(pct)
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-medium">{label}</div>
        <div className={`text-xs tabular-nums ${cls.text}`}>
          {pct === null ? 'no cap' : `${pct.toFixed(0)}%`}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        {used} {pct !== null && <span>/ {cap}</span>}
      </div>
      {pct !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-background/60">
          <div className={`h-full transition-all ${cls.bar}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
