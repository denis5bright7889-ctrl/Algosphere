import { redirect } from 'next/navigation'
import { FlaskConical, CheckCircle2, Circle, ShieldCheck, Activity, Cpu, GitBranch, Rocket } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { tierIncludes } from '@/lib/entitlements'
import { getEffectiveTier } from '@/lib/tier-resolver'
import TierLock from '@/components/tier/TierLock'
import {
  computeInstitutionalAnalytics, MIN_SAMPLE as ANALYTICS_MIN_SAMPLE,
} from '@/lib/intelligence/validation-analytics'
import {
  aggregateBrokerQuality, BROKER_MIN_SAMPLE,
  type BrokerGrade, type BrokerQuality,
} from '@/lib/intelligence/broker-quality-aggregate'
import { buildEquityCurve } from '@/lib/intelligence/equity-curve'
import EquityCurveChart from '@/components/shadow/EquityCurveChart'
import {
  aggregateStrategyPerformance, STRATEGY_MIN_SAMPLE,
  type StrategyMetrics, type StrategyRanking,
} from '@/lib/intelligence/strategy-performance-aggregate'
import {
  reviewAllStrategiesForValidation,
  type ValidationCoachReview, type ValidationCoachGrade,
  type ValidationCoachRecommendation,
} from '@/lib/intelligence/validation-coach'
import { deriveMilestones, type Achievement } from '@/lib/intelligence/milestones'
import { Trophy, Lock, Award, Zap, Shield, Building2, Crown, Flame, FileSearch } from 'lucide-react'

export const metadata = { title: 'AI Strategy Validation Center — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

interface ShadowRow {
  id: string
  symbol: string
  direction: string
  broker: string
  intended_lot: number
  intended_entry: number | null
  actual_status: string
  actual_fill_price: number | null
  slippage_pct: number | null
  skip_reason: string | null
  leader_pnl: number | null
  follower_pnl: number | null
  pnl_drift_pct: number | null
  created_at: string
  closed_at: string | null
}

// Validation gate thresholds — same numbers as before; named here so
// the Phase-2 requirements checklist can introspect them.
const GATE = {
  SESSIONS:        50,
  FILL_RATE_PCT:   95,
  SLIPPAGE_MAX:    0.001,   // 0.1%
  DRIFT_MAX_PCT:   2,
  CONFIDENCE_MIN:  0.6,     // future use — strategy confidence floor
} as const

export default async function ShadowPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tier } = await getEffectiveTier()
  if (!tierIncludes(tier, 'premium')) {
    return (
      <TierLock minTier="premium" tier={tier} from="/shadow">
        <ShadowSkeleton />
      </TierLock>
    )
  }

  const { data: rows } = await supabase
    .from('shadow_executions')
    .select(`
      id, symbol, direction, broker, intended_lot, intended_entry,
      actual_status, actual_fill_price, slippage_pct, skip_reason,
      leader_pnl, follower_pnl, pnl_drift_pct, created_at, closed_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500)

  const list   = (rows ?? []) as ShadowRow[]
  const closed = list.filter(r => r.closed_at)
  const mirrored = list.filter(r => r.actual_status === 'mirrored' || r.actual_status === 'testnet').length
  const fillRate = list.length > 0 ? Math.round((mirrored / list.length) * 100) : 0

  const avgSlippage = closed.length > 0
    ? closed.reduce((s, r) => s + Math.abs(Number(r.slippage_pct ?? 0)), 0) / closed.length
    : 0
  const driftSamples = closed.filter(r => r.pnl_drift_pct != null)
  const avgDrift = driftSamples.length > 0
    ? driftSamples.reduce((s, r) => s + Math.abs(Number(r.pnl_drift_pct ?? 0)), 0) / driftSamples.length
    : 0

  // ── Phase 2: requirements checklist ────────────────────────────────
  const requirements = [
    { id: 'sessions',   label: `${GATE.SESSIONS}+ validation sessions`,
      met: list.length >= GATE.SESSIONS,
      progress: Math.min(list.length / GATE.SESSIONS, 1) },
    { id: 'drawdown',   label: `Average drift below ${GATE.DRIFT_MAX_PCT}%`,
      met: driftSamples.length > 0 && avgDrift < GATE.DRIFT_MAX_PCT,
      progress: driftSamples.length > 0 ? Math.max(0, 1 - avgDrift / GATE.DRIFT_MAX_PCT) : 0 },
    { id: 'execution',  label: `Fill rate ≥ ${GATE.FILL_RATE_PCT}%`,
      met: list.length > 0 && fillRate >= GATE.FILL_RATE_PCT,
      progress: fillRate / 100 },
    { id: 'slippage',   label: `Average slippage under ${(GATE.SLIPPAGE_MAX * 100).toFixed(2)}%`,
      met: closed.length > 0 && avgSlippage < GATE.SLIPPAGE_MAX,
      progress: closed.length > 0 ? Math.max(0, 1 - avgSlippage / GATE.SLIPPAGE_MAX) : 0 },
    { id: 'confidence', label: `Strategy confidence threshold (≥ ${Math.round(GATE.CONFIDENCE_MIN * 100)}%)`,
      met: false, progress: 0  /* wired in when strategy-validation table lands */ },
  ]
  const reqsMet  = requirements.filter(r => r.met).length
  const ready    = reqsMet === requirements.length

  // ── Phase 2: 5-stage progression. Stage advances as gates clear in
  //    a fixed order (sessions → execution → risk → live-qual → ready).
  const stages = [
    { key: 'signal',    label: 'Signal Validation',    icon: Activity,    done: requirements[0]!.met },
    { key: 'execution', label: 'Execution Validation', icon: Cpu,         done: requirements[0]!.met && requirements[2]!.met },
    { key: 'risk',      label: 'Risk Validation',      icon: ShieldCheck, done: requirements[0]!.met && requirements[2]!.met && requirements[3]!.met },
    { key: 'qualify',   label: 'Live Qualification',   icon: GitBranch,   done: requirements[0]!.met && requirements[2]!.met && requirements[3]!.met && requirements[1]!.met },
    { key: 'ready',     label: 'Deployment Ready',     icon: Rocket,      done: ready },
  ]
  const currentStageIdx = stages.findIndex(s => !s.done)
  const currentStage    = currentStageIdx === -1 ? stages.length - 1 : currentStageIdx

  // ── Phase 2: estimated unlock date — deterministic projection from
  //    the realised session-growth rate over the past 14 days. Honest
  //    null when no recent sessions logged.
  const since14d = Date.now() - 14 * 86_400_000
  const recent14d = list.filter(r => new Date(r.created_at).getTime() >= since14d).length
  const sessionsPerDay = recent14d / 14
  const sessionsRemaining = Math.max(0, GATE.SESSIONS - list.length)
  const daysToUnlock = sessionsPerDay > 0 ? Math.ceil(sessionsRemaining / sessionsPerDay) : null
  const estimatedUnlock = daysToUnlock != null
    ? new Date(Date.now() + daysToUnlock * 86_400_000).toLocaleDateString(undefined,
        { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  // ── Phase 8: institutional analytics from closed shadow trades ─────
  const tradeOutcomes = closed
    .filter(r => typeof r.follower_pnl === 'number')
    .map(r => ({ follower_pnl: r.follower_pnl as number, closed_at: r.closed_at }))
  const analytics = computeInstitutionalAnalytics(tradeOutcomes)

  // ── Phase 3: broker quality grading from all shadow rows ───────────
  const brokerQuality = aggregateBrokerQuality(list)

  // ── Phase 6: equity curve from closed shadow trades ────────────────
  const curve = buildEquityCurve(
    closed
      .filter(r => typeof r.follower_pnl === 'number')
      .map(r => ({ follower_pnl: r.follower_pnl as number, closed_at: r.closed_at })),
  )

  // ── Phase 5: strategy attribution + performance report ─────────────
  // 3-hop join: shadow_executions.copy_trade_id → copy_trades →
  // strategy_subscriptions → published_strategies.name. Supabase's
  // nested-select syntax does it in one round-trip.
  // We only need rows that HAVE a copy_trade_id (others can't be
  // attributed to a strategy) and we re-pull the per-row outcome
  // fields the aggregator needs.
  const { data: attributedRows } = list.length > 0
    ? await supabase
        .from('shadow_executions')
        .select(`
          id, created_at, closed_at, follower_pnl, actual_status,
          slippage_pct, pnl_drift_pct,
          copy_trade:copy_trades (
            subscription:strategy_subscriptions (
              strategy:published_strategies ( id, name )
            )
          )
        `)
        .eq('user_id', user.id)
        .not('copy_trade_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [] }

  type AttribRow = {
    created_at:    string
    closed_at:     string | null
    follower_pnl:  number | null
    actual_status: string
    slippage_pct:  number | null
    pnl_drift_pct: number | null
    copy_trade?: {
      subscription?: {
        strategy?: { id: string; name: string } | null
      } | null
    } | null
  }

  const strategyRows = (attributedRows ?? [])
    .map((r) => {
      const ar = r as unknown as AttribRow
      const strat = ar.copy_trade?.subscription?.strategy
      if (!strat?.id) return null
      return {
        strategy_id:    strat.id,
        strategy_name:  strat.name,
        follower_pnl:   ar.follower_pnl,
        closed_at:      ar.closed_at,
        created_at:     ar.created_at,
        actual_status:  ar.actual_status,
        slippage_pct:   ar.slippage_pct,
        pnl_drift_pct:  ar.pnl_drift_pct,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const stratReport = aggregateStrategyPerformance(strategyRows)

  // ── Phase 7: AI Strategy Coach reviews per graded strategy ─────────
  const coachReviews = reviewAllStrategiesForValidation(stratReport.strategies)

  // ── Phase 4 forensics rows for the recent shadow list. Inline join
  //    is cheap (20 shadow rows × shadow_execution_id lookup). The
  //    UI surfaces composite + grade per row without fanning out.
  const recentIds = list.slice(0, 50).map(r => r.id)
  const { data: forensicsData } = recentIds.length > 0
    ? await supabase
        .from('trade_quality_scores')
        .select('shadow_execution_id, composite_score, grade, entry_quality, execution_quality, outcome_quality, process_quality')
        .in('shadow_execution_id', recentIds)
    : { data: [] }
  const forensicsByShadow = new Map<string, {
    composite: number; grade: string
    entry: number; exec: number; outcome: number; process: number
  }>()
  for (const f of ((forensicsData ?? []) as Array<{
    shadow_execution_id: string; composite_score: number; grade: string
    entry_quality: number; execution_quality: number; outcome_quality: number; process_quality: number
  }>)) {
    forensicsByShadow.set(f.shadow_execution_id, {
      composite: f.composite_score, grade: f.grade,
      entry:     f.entry_quality,   exec:  f.execution_quality,
      outcome:   f.outcome_quality, process: f.process_quality,
    })
  }

  // ── Phase 10: gamification — derive earned/locked badges + streak
  //    from the aggregates we already computed. No DB hit; the
  //    validation_milestones writer ships in a later slice.
  const milestones = deriveMilestones({
    closedTrades: closed
      .filter(r => typeof r.follower_pnl === 'number')
      .map(r => ({ follower_pnl: r.follower_pnl as number, closed_at: r.closed_at })),
    brokerQuality,
    strategies:   stratReport.strategies,
    coachReviews,
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* ── Phase 1: rebrand ──────────────────────────────────────── */}
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          AI Strategy <span className="text-gradient">Validation Center</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Every strategy must earn the right to trade live. AlgoSphere validates
          execution quality, risk behavior, consistency, and broker performance
          using forward-tested market data before capital is exposed.
        </p>
      </header>

      <div className="mb-6 flex items-start gap-2 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] px-3 py-2.5 text-xs text-blue-200">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>
          <span className="font-bold uppercase tracking-wider">Validation In Progress</span>{' '}
          — Every full-auto signal is recorded with intent + outcome against a{' '}
          <em>simulated / testnet</em> fill. <span className="font-semibold">No live
          orders are placed on this screen.</span> Live execution unlocks only after
          all validation gates pass and you explicitly promote a broker.
        </span>
      </div>

      {/* ── Phase 2: 5-stage progression ──────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">Validation Progress</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {list.length} / {GATE.SESSIONS} sessions
            {estimatedUnlock && (
              <span> · est. unlock <span className="text-foreground">{estimatedUnlock}</span></span>
            )}
          </p>
        </div>

        {/* 5 stage pills */}
        <ol className="relative grid grid-cols-5 gap-1 sm:gap-2 mb-5">
          {stages.map((s, i) => {
            const Icon = s.icon
            const isCurrent = i === currentStage
            return (
              <li key={s.key} className="relative">
                <div className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-center transition',
                  s.done && 'border-emerald-500/40 bg-emerald-500/[0.08]',
                  !s.done && isCurrent && 'border-amber-500/40 bg-amber-500/[0.06]',
                  !s.done && !isCurrent && 'border-border bg-muted/10',
                )}>
                  <Icon className={cn(
                    'h-4 w-4 sm:h-5 sm:w-5',
                    s.done && 'text-emerald-400',
                    !s.done && isCurrent && 'text-amber-300',
                    !s.done && !isCurrent && 'text-muted-foreground',
                  )} strokeWidth={1.75} aria-hidden />
                  <div className={cn(
                    'text-[9px] sm:text-[10px] font-bold uppercase tracking-wider leading-tight',
                    s.done && 'text-emerald-300',
                    !s.done && isCurrent && 'text-amber-200',
                    !s.done && !isCurrent && 'text-muted-foreground',
                  )}>
                    Stage {i + 1}
                  </div>
                  <div className={cn(
                    'text-[10px] sm:text-[11px] leading-tight font-medium',
                    s.done ? 'text-foreground' : isCurrent ? 'text-foreground' : 'text-muted-foreground',
                  )}>
                    {s.label}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        {/* Requirements checklist */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
            Requirements ({reqsMet}/{requirements.length} met)
          </p>
          {requirements.map(r => (
            <div key={r.id} className="flex items-center gap-2.5 text-[12px]">
              {r.met
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2} aria-hidden />
                : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />}
              <span className={cn('flex-1', r.met ? 'text-foreground' : 'text-muted-foreground')}>
                {r.label}
              </span>
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {Math.round(r.progress * 100)}%
              </span>
            </div>
          ))}
        </div>

        <div className={cn(
          'mt-4 rounded-lg border px-3 py-2 text-[11px]',
          ready
            ? 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-200'
            : 'border-amber-500/30 bg-amber-500/[0.04] text-amber-200',
        )}>
          {ready
            ? '✓ Capital Protection cleared — this strategy + broker pair is ready for live promotion.'
            : `Capital Protection Layer Enabled — ${requirements.length - reqsMet} requirement${requirements.length - reqsMet === 1 ? '' : 's'} outstanding before live execution unlocks.`}
        </div>
      </section>

      {/* ── Phase 1: surface-level qualification pills ────────────── */}
      {(() => {
        const hasData    = list.length > 0
        const hasClosed  = driftSamples.length > 0
        const execQuality = !hasData ? 'Collecting Data'
          : fillRate >= 95 ? 'Excellent' : fillRate >= 80 ? 'Good' : 'Developing'
        const stability  = !hasClosed ? 'Awaiting Closed Trades'
          : (avgSlippage < GATE.SLIPPAGE_MAX && avgDrift < GATE.DRIFT_MAX_PCT) ? 'Stable' : 'Variable'
        const trackRecord = list.length >= GATE.SESSIONS ? 'Established' : 'Building'
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat label="Track Record" value={trackRecord} tone="plain" />
            <Stat label="Execution Quality" value={execQuality}
                  tone={!hasData ? 'plain' : fillRate >= 95 ? 'green' : fillRate >= 80 ? 'amber' : 'red'} />
            <Stat label="Strategy Stability" value={stability}
                  tone={!hasClosed ? 'plain' : stability === 'Stable' ? 'green' : 'amber'} />
            <Stat label="Qualification" value={ready ? 'Qualified' : 'Verification Running'}
                  tone={ready ? 'green' : 'amber'} />
          </div>
        )
      })()}

      {/* ── Phase 8: institutional analytics ─────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">Institutional Analytics</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {analytics.sample_size > 0
              ? `${analytics.sample_size} closed trade${analytics.sample_size === 1 ? '' : 's'}`
              : 'No closed trades'}
            {' · '}
            {analytics.sample_size < ANALYTICS_MIN_SAMPLE
              ? <span className="text-amber-300">activates at {ANALYTICS_MIN_SAMPLE} closed</span>
              : <span className="text-emerald-400">live</span>}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric label="Sharpe"          value={analytics.sharpe}          fmt="ratio"   />
          <Metric label="Sortino"         value={analytics.sortino}         fmt="ratio"   />
          <Metric label="Calmar"          value={analytics.calmar}          fmt="ratio"   />
          <Metric label="Profit Factor"   value={analytics.profit_factor}   fmt="ratio"   />
          <Metric label="Recovery Factor" value={analytics.recovery_factor} fmt="ratio"   />
          <Metric label="Avg R Multiple"  value={analytics.avg_r_multiple}  fmt="ratio"   />
          <Metric label="Expected Value"  value={analytics.expected_value}  fmt="usd"     />
          <Metric label="Kelly %"         value={analytics.kelly_pct}       fmt="pct"     />
          <Metric label="Risk of Ruin"    value={analytics.risk_of_ruin}    fmt="pct"     invertTone />
          <Metric label="Max Drawdown"    value={analytics.max_drawdown}    fmt="usd"     invertTone />
          <Metric label="Net P&L"         value={analytics.net_profit}      fmt="usd"     />
          <Metric label="Win Rate"        value={analytics.win_rate_pct}    fmt="pct"     />
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground/80">
          Methodology: Sharpe + Sortino annualised by √252. Kelly capped at 25% (institutional half-Kelly).
          Risk-of-ruin uses gambler's-ruin closed form against a 100×-average-loss bankroll.
          All metrics suppress to N/A below {ANALYTICS_MIN_SAMPLE} closed trades — outcome-based claims need sample.
        </p>
      </section>

      {/* ── Phase 3: Broker Quality grading ──────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">Broker Quality</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {brokerQuality.length > 0
              ? `${brokerQuality.length} broker${brokerQuality.length === 1 ? '' : 's'} observed`
              : 'No broker activity yet'}
            {' · '}
            <span className="text-muted-foreground">grades activate at {BROKER_MIN_SAMPLE} executions per broker</span>
          </p>
        </div>

        {brokerQuality.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-center text-xs text-muted-foreground">
            Broker grades appear once shadow executions begin landing per broker.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {brokerQuality.map((b) => (
              <BrokerCard key={b.broker} q={b} />
            ))}
          </div>
        )}

        <p className="mt-3 text-[10px] text-muted-foreground/80">
          Methodology: Execution Quality Score = 40% fill rate + 35% slippage + 25% drift,
          each normalised against an institutional anchor. A+ ≥ 95, A ≥ 90, B+ ≥ 85, B ≥ 80, C ≥ 70, else D.
          Percentile rank compares your brokers to each other — meaningful only with ≥ 2 graded brokers.
        </p>
      </section>

      {/* ── Phase 6: Validation Equity Curve ─────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">Validation Equity Curve</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {curve.summary.point_count > 0
              ? <>
                  {curve.summary.point_count} day{curve.summary.point_count === 1 ? '' : 's'} ·{' '}
                  <span className="text-foreground">{curve.summary.curve_start_date}</span>
                  {' → '}
                  <span className="text-foreground">{curve.summary.curve_end_date}</span>
                </>
              : 'Awaiting closed trades'}
          </p>
        </div>
        <EquityCurveChart points={curve.points} summary={curve.summary} />
      </section>

      {/* ── Phase 5: Strategy Performance Center ─────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">Strategy Performance Center</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {stratReport.strategies.length > 0
              ? `${stratReport.strategies.length} strateg${stratReport.strategies.length === 1 ? 'y' : 'ies'} attributed · grades activate at ${STRATEGY_MIN_SAMPLE} closed`
              : 'No strategies attributed yet'}
          </p>
        </div>

        {stratReport.empty || stratReport.strategies.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-center text-xs text-muted-foreground">
            Subscribe to a published strategy in full-auto mode to begin per-strategy validation.
          </p>
        ) : (
          <>
            <StrategyMetricsTable strategies={stratReport.strategies} />

            {stratReport.rankings.length > 0 && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {stratReport.rankings.map((r) => (
                  <RankingCard key={r.category} ranking={r} />
                ))}
              </div>
            )}
          </>
        )}

        <p className="mt-3 text-[10px] text-muted-foreground/80">
          Methodology: 10 institutional metrics per strategy (win rate, profit factor, Sharpe, Sortino,
          expectancy, avg hold, max drawdown, recovery factor, risk score, confidence score) computed
          from closed shadow trades. Rankings activate only with ≥ 2 strategies above the {STRATEGY_MIN_SAMPLE}-trade
          sample threshold — one-strategy "leaderboards" are dishonest.
        </p>
      </section>

      {/* ── Phase 7: AI Strategy Coach v2 ─────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">AI Strategy Coach</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {coachReviews.length > 0
              ? `${coachReviews.length} strateg${coachReviews.length === 1 ? 'y' : 'ies'} reviewed · approve-ready first`
              : 'Reviews activate at the institutional sample threshold'}
          </p>
        </div>

        {coachReviews.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-center text-xs text-muted-foreground">
            Coach reviews appear once a strategy clears {STRATEGY_MIN_SAMPLE} closed shadow trades. The coach
            refuses to review undersampled strategies — no fabricated grades.
          </p>
        ) : (
          <div className="space-y-3">
            {coachReviews.map((r) => (
              <CoachReviewCard key={r.strategy_id} review={r} />
            ))}
          </div>
        )}

        <p className="mt-3 text-[10px] text-muted-foreground/80">
          Methodology: Readiness score = 25% sample + 25% PF + 20% Sharpe + 15% drawdown + 15% win rate.
          Grade follows readiness (A+ ≥ 95, A ≥ 90, B+ ≥ 85, B ≥ 80, C ≥ 70, else D). Recommendation is
          mechanical: approve ≥ 80, watchlist 60–79, reject &lt; 60. Coach is fully deterministic — no LLM.
        </p>
      </section>

      {/* ── Phase 10: Achievements (gamification) ────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-bold uppercase tracking-widest">Achievements</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            <span className="text-foreground">{milestones.earned_count}</span>/{milestones.total_count} earned ·{' '}
            current streak <span className="text-foreground">{milestones.current_streak}</span> ·{' '}
            best <span className="text-foreground">{milestones.best_streak}</span>
          </p>
        </div>

        {/* Current streak banner — shows up only when there IS a streak */}
        {milestones.current_streak > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200">
            <Flame className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>
              <span className="font-bold">{milestones.current_streak}-trade winning streak</span> active.
              {milestones.best_streak > milestones.current_streak && (
                <span className="text-amber-200/80"> Best ever: {milestones.best_streak}.</span>
              )}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
          {milestones.achievements.map((a) => (
            <AchievementBadge key={a.kind} a={a} />
          ))}
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground/80">
          Methodology: Every badge ties to a numeric threshold against your real aggregates — no
          fabricated achievements. The "Top 1% Validation" badge is permanently locked until
          peer-comparison data is available; we won't award it against a placeholder.
        </p>
      </section>

      {/* ── Recent executions table (existing surface) ────────────── */}
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Recent Validation Sessions
      </h2>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Broker Qualification Active</p>
          <p>Subscribe to a strategy in full-auto mode to begin Strategy Verification.</p>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <ul className="space-y-2.5 md:hidden">
            {list.map(r => {
              const slipPct = r.slippage_pct != null ? Math.abs(r.slippage_pct) : null
              const driftPct = r.pnl_drift_pct
              return (
                <li key={r.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-semibold truncate">{r.symbol}</span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[9px] font-bold',
                        r.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                      )}>
                        {r.direction.toUpperCase()}
                      </span>
                    </span>
                    <span className={cn(
                      'rounded-full border px-2 py-0.5 text-[9px] font-bold capitalize shrink-0',
                      r.actual_status === 'mirrored' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                      r.actual_status === 'testnet'  && 'border-blue-500/40 bg-blue-500/10 text-blue-300',
                      r.actual_status === 'failed'   && 'border-rose-500/40 bg-rose-500/10 text-rose-300',
                      (r.actual_status === 'skipped' || r.actual_status === 'shadow_only') && 'border-border bg-muted/30 text-muted-foreground',
                    )}>
                      {r.actual_status}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Lot @ Entry</p>
                      <p className="tabular-nums">{r.intended_lot} @ {r.intended_entry ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Slip</p>
                      <p className={cn(
                        'tabular-nums',
                        slipPct == null ? 'text-muted-foreground'
                          : slipPct < 0.001 ? 'text-emerald-400'
                          : slipPct < 0.005 ? 'text-amber-300'
                          : 'text-rose-400',
                      )}>
                        {r.slippage_pct != null ? `${(r.slippage_pct * 100).toFixed(3)}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Drift</p>
                      <p className={cn(
                        'tabular-nums',
                        driftPct == null ? 'text-muted-foreground'
                          : Math.abs(driftPct) < 2 ? 'text-emerald-400'
                          : Math.abs(driftPct) < 5 ? 'text-amber-300'
                          : 'text-rose-400',
                      )}>
                        {driftPct != null ? `${driftPct.toFixed(2)}%` : '—'}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead>
              <tr className="text-left text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/40">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Dir</th>
                <th className="px-4 py-2.5 text-right">Intended</th>
                <th className="px-4 py-2.5 text-right">Filled</th>
                <th className="px-4 py-2.5 text-right">Slip</th>
                <th className="px-4 py-2.5 text-right">Drift</th>
                <th className="px-4 py-2.5 text-right">Forensics</th>
                <th className="px-4 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} className="border-b border-border/30 last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-2 text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono">{r.symbol}</td>
                  <td className={cn(
                    'px-4 py-2 font-bold',
                    r.direction === 'buy' ? 'text-emerald-400' : 'text-rose-400',
                  )}>
                    {r.direction.toUpperCase()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.intended_lot} @ {r.intended_entry ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.actual_fill_price ?? '—'}
                  </td>
                  <td className={cn(
                    'px-4 py-2 text-right tabular-nums',
                    Math.abs(Number(r.slippage_pct ?? 0)) < 0.001 ? 'text-emerald-400'
                      : Math.abs(Number(r.slippage_pct ?? 0)) < 0.005 ? 'text-amber-300'
                      : 'text-rose-400',
                  )}>
                    {r.slippage_pct != null ? `${(r.slippage_pct * 100).toFixed(3)}%` : '—'}
                  </td>
                  <td className={cn(
                    'px-4 py-2 text-right tabular-nums',
                    r.pnl_drift_pct != null && Math.abs(r.pnl_drift_pct) < 2 ? 'text-emerald-400'
                      : r.pnl_drift_pct != null && Math.abs(r.pnl_drift_pct) < 5 ? 'text-amber-300'
                      : r.pnl_drift_pct != null ? 'text-rose-400' : 'text-muted-foreground',
                  )}>
                    {r.pnl_drift_pct != null ? `${r.pnl_drift_pct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <ForensicsCell f={forensicsByShadow.get(r.id) ?? null} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={cn(
                      'rounded-full border px-2 py-0.5 text-[9px] font-bold capitalize',
                      r.actual_status === 'mirrored' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                      r.actual_status === 'testnet'  && 'border-blue-500/40 bg-blue-500/10 text-blue-300',
                      r.actual_status === 'failed'   && 'border-rose-500/40 bg-rose-500/10 text-rose-300',
                      (r.actual_status === 'skipped' || r.actual_status === 'shadow_only') && 'border-border bg-muted/30 text-muted-foreground',
                    )}>
                      {r.actual_status}
                    </span>
                    {/* Manual close: only on open positions */}
                    {!r.closed_at && (r.actual_status === 'mirrored' || r.actual_status === 'testnet') && (
                      <a
                        href={`/api/admin/shadow-manual-close?prefill=${r.id}`}
                        className="ml-2 inline-flex h-6 items-center rounded border border-border/60 bg-muted/20 px-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/40"
                        title="Manual close (admin)"
                      >
                        Close
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'amber' | 'red'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-xl font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'amber' && 'text-amber-300',
        tone === 'red'   && 'text-rose-400',
      )}>{value}</p>
    </div>
  )
}

/** Phase 8 metric tile. Renders the value with appropriate unit/sign
 *  and a green/amber/red tone derived from the metric's good direction.
 *  invertTone=true means LOW is good (drawdown, risk of ruin). */
function Metric({ label, value, fmt, invertTone = false }: {
  label: string
  value: number | null
  fmt:   'ratio' | 'pct' | 'usd'
  invertTone?: boolean
}) {
  const display = value == null ? 'N/A' :
    fmt === 'ratio' ? value.toFixed(2) :
    fmt === 'pct'   ? `${value.toFixed(2)}%` :
    /* usd */         `${value >= 0 ? '+' : ''}${value.toFixed(2)}`

  // Tone heuristics. Ratio metrics: Sharpe>1 / PF>1.5 → green. Pct: low
  // is good when invertTone. USD: positive = green.
  let tone: 'plain' | 'green' | 'amber' | 'red' = 'plain'
  if (value != null) {
    if (fmt === 'ratio') {
      tone = value >= 1.5 ? 'green' : value >= 1.0 ? 'amber' : 'red'
    } else if (fmt === 'pct') {
      const good = invertTone ? value < 1 : value > 0
      const bad  = invertTone ? value > 5 : value < 0
      tone = good ? 'green' : bad ? 'red' : 'amber'
    } else if (fmt === 'usd') {
      const positive = value >= 0
      tone = invertTone
        ? (Math.abs(value) === 0 ? 'green' : 'amber')
        : (positive ? 'green' : 'red')
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-0.5 text-sm font-bold tabular-nums',
        value == null && 'text-muted-foreground',
        tone === 'green' && 'text-emerald-400',
        tone === 'amber' && 'text-amber-300',
        tone === 'red'   && 'text-rose-400',
      )}>{display}</p>
    </div>
  )
}

/** Phase 3 broker quality card. Shows the broker name, grade chip,
 *  composite score, and the 4 observable sub-metrics. "Collecting Data"
 *  pill replaces the grade chip below the sample threshold so we
 *  never display a fabricated grade. */
function BrokerCard({ q }: { q: BrokerQuality }) {
  const isGraded = q.execution_quality_score != null && q.grade != null
  const gradeTone: Record<BrokerGrade, string> = {
    'A+': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    'A':  'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    'B+': 'border-blue-500/40 bg-blue-500/10 text-blue-300',
    'B':  'border-blue-500/40 bg-blue-500/10 text-blue-300',
    'C':  'border-amber-500/40 bg-amber-500/10 text-amber-300',
    'D':  'border-rose-500/40 bg-rose-500/10 text-rose-300',
  }

  return (
    <div className="rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{q.broker}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
            {q.sample_size} execution{q.sample_size === 1 ? '' : 's'}
            {isGraded && q.better_than_pct != null && q.better_than_pct > 0 && (
              <span> · better than {q.better_than_pct}% of your brokers</span>
            )}
          </p>
        </div>
        {isGraded ? (
          <div className="text-right shrink-0">
            <span className={cn(
              'rounded-md border px-2 py-0.5 text-sm font-black tabular-nums',
              gradeTone[q.grade as BrokerGrade],
            )}>
              {q.grade}
            </span>
            <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground tabular-nums">
              Score {q.execution_quality_score}
            </p>
          </div>
        ) : (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-300 shrink-0">
            Collecting Data
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
        <SubMetric label="Fill"
                   value={`${q.fill_rate_pct}%`}
                   tone={q.fill_rate_pct >= 95 ? 'green' : q.fill_rate_pct >= 80 ? 'amber' : 'red'} />
        <SubMetric label="Slip"
                   value={q.avg_slippage_pct == null ? '—' : `${(q.avg_slippage_pct * 100).toFixed(3)}%`}
                   tone={q.avg_slippage_pct == null ? 'plain'
                     : q.avg_slippage_pct < 0.001 ? 'green'
                     : q.avg_slippage_pct < 0.005 ? 'amber' : 'red'} />
        <SubMetric label="Drift"
                   value={q.avg_drift_pct == null ? '—' : `${q.avg_drift_pct.toFixed(2)}%`}
                   tone={q.avg_drift_pct == null ? 'plain'
                     : q.avg_drift_pct < 2 ? 'green'
                     : q.avg_drift_pct < 5 ? 'amber' : 'red'} />
        <SubMetric label="Failed"
                   value={String(q.failed_count)}
                   tone={q.failed_count === 0 ? 'green' : q.failed_count < 3 ? 'amber' : 'red'} />
      </div>

      {/* Spread / latency / requote rows — null because the schema
          doesn't carry these yet. Shown as "—" with a footnote so users
          see the future shape but no fabricated value. */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground/80">
        <div className="flex justify-between"><span>Spread</span><span>—</span></div>
        <div className="flex justify-between"><span>Latency</span><span>—</span></div>
        <div className="flex justify-between"><span>Requote</span><span>—</span></div>
      </div>
    </div>
  )
}

function SubMetric({ label, value, tone }: {
  label: string
  value: string
  tone:  'plain' | 'green' | 'amber' | 'red'
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'tabular-nums font-semibold',
        tone === 'green' && 'text-emerald-400',
        tone === 'amber' && 'text-amber-300',
        tone === 'red'   && 'text-rose-400',
      )}>{value}</p>
    </div>
  )
}

/** Phase 5: per-strategy metric table. */
function StrategyMetricsTable({ strategies }: { strategies: StrategyMetrics[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="text-left text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/40">
            <th className="px-3 py-2 font-medium">Strategy</th>
            <th className="px-3 py-2 text-right font-medium">Sample</th>
            <th className="px-3 py-2 text-right font-medium">Win Rate</th>
            <th className="px-3 py-2 text-right font-medium">PF</th>
            <th className="px-3 py-2 text-right font-medium">Sharpe</th>
            <th className="px-3 py-2 text-right font-medium">Sortino</th>
            <th className="px-3 py-2 text-right font-medium">Expectancy</th>
            <th className="px-3 py-2 text-right font-medium">Avg Hold</th>
            <th className="px-3 py-2 text-right font-medium">Max DD</th>
            <th className="px-3 py-2 text-right font-medium">Recovery</th>
            <th className="px-3 py-2 text-right font-medium">Risk</th>
            <th className="px-3 py-2 text-right font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {strategies.map((s) => {
            const v = (x: number | null, fmt: 'pct' | 'num' | 'usd' | 'hours' = 'num') => {
              if (x == null) return <span className="text-muted-foreground/50">—</span>
              if (fmt === 'pct')   return `${x}%`
              if (fmt === 'usd')   return `${x >= 0 ? '+' : ''}${x.toFixed(2)}`
              if (fmt === 'hours') return `${x}h`
              return x.toFixed(2)
            }
            return (
              <tr key={s.strategy_id} className="border-b border-border/30 last:border-0 hover:bg-muted/10">
                <td className="px-3 py-2 font-medium truncate max-w-[180px]" title={s.strategy_name}>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{s.strategy_name}</span>
                    {s.collecting_data && (
                      <span className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-300 shrink-0">
                        Collecting
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {s.closed_count}/{s.sample_size}
                </td>
                <td className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  s.win_rate_pct == null ? ''
                    : s.win_rate_pct >= 55 ? 'text-emerald-400'
                    : s.win_rate_pct >= 45 ? 'text-amber-300' : 'text-rose-400',
                )}>{v(s.win_rate_pct, 'pct')}</td>
                <td className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  s.profit_factor == null ? ''
                    : s.profit_factor >= 1.5 ? 'text-emerald-400'
                    : s.profit_factor >= 1   ? 'text-amber-300' : 'text-rose-400',
                )}>{v(s.profit_factor)}</td>
                <td className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  s.sharpe == null ? ''
                    : s.sharpe >= 1.5 ? 'text-emerald-400'
                    : s.sharpe >= 1   ? 'text-amber-300' : 'text-rose-400',
                )}>{v(s.sharpe)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{v(s.sortino)}</td>
                <td className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  s.expectancy == null ? ''
                    : s.expectancy > 0 ? 'text-emerald-400' : 'text-rose-400',
                )}>{v(s.expectancy, 'usd')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{v(s.avg_holding_hours, 'hours')}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-400/80">
                  {s.max_drawdown == null ? '—' : `−${s.max_drawdown.toFixed(2)}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{v(s.recovery_factor)}</td>
                <td className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  s.risk_score == null ? ''
                    : s.risk_score >= 70 ? 'text-emerald-400'
                    : s.risk_score >= 50 ? 'text-amber-300' : 'text-rose-400',
                )}>{v(s.risk_score)}</td>
                <td className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  s.confidence_score == null ? ''
                    : s.confidence_score >= 70 ? 'text-emerald-400'
                    : s.confidence_score >= 50 ? 'text-amber-300' : 'text-rose-400',
                )}>{v(s.confidence_score)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Phase 5: ranking card (one of top / worst / consistent / risky). */
function RankingCard({ ranking }: { ranking: StrategyRanking }) {
  const toneByCategory: Record<StrategyRanking['category'], string> = {
    top:        'border-emerald-500/30 bg-emerald-500/[0.04]',
    worst:      'border-rose-500/30 bg-rose-500/[0.04]',
    consistent: 'border-blue-500/30 bg-blue-500/[0.04]',
    risky:      'border-amber-500/30 bg-amber-500/[0.04]',
  }
  return (
    <div className={cn('rounded-xl border bg-background/30 p-3', toneByCategory[ranking.category])}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-xs font-bold uppercase tracking-wider">{ranking.label}</p>
        <p className="text-[9px] text-muted-foreground">{ranking.criterion}</p>
      </div>
      {ranking.entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">—</p>
      ) : (
        <ol className="space-y-1">
          {ranking.entries.map((e, i) => (
            <li key={e.strategy_id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground tabular-nums w-4">{i + 1}.</span>
                <span className="truncate font-medium">{e.strategy_name}</span>
              </span>
              <span className="tabular-nums shrink-0 text-muted-foreground">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Phase 7 AI Strategy Coach review card. */
function CoachReviewCard({ review }: { review: ValidationCoachReview }) {
  const gradeTone: Record<ValidationCoachGrade, string> = {
    'A+': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    'A':  'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    'B+': 'border-blue-500/40 bg-blue-500/10 text-blue-300',
    'B':  'border-blue-500/40 bg-blue-500/10 text-blue-300',
    'C':  'border-amber-500/40 bg-amber-500/10 text-amber-300',
    'D':  'border-rose-500/40 bg-rose-500/10 text-rose-300',
  }
  const recTone: Record<ValidationCoachRecommendation, string> = {
    approve:   'border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200',
    watchlist: 'border-amber-500/40  bg-amber-500/[0.08]    text-amber-200',
    reject:    'border-rose-500/40   bg-rose-500/[0.08]     text-rose-200',
  }
  const recLabel: Record<ValidationCoachRecommendation, string> = {
    approve:   '✓ Approve for Live',
    watchlist: '⏳ Watchlist',
    reject:    '✕ Reject',
  }

  return (
    <div className="rounded-xl border border-border bg-background/30 p-4">
      {/* Header: name + grade chip + readiness + recommendation pill */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{review.strategy_name}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
            Readiness {review.readiness_score}/100
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            'rounded-md border px-2 py-0.5 text-sm font-black tabular-nums',
            gradeTone[review.overall_grade],
          )}>
            {review.overall_grade}
          </span>
          <span className={cn(
            'rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
            recTone[review.recommendation],
          )}>
            {recLabel[review.recommendation]}
          </span>
        </div>
      </div>

      {/* Readiness bar */}
      <div className="mb-4">
        <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              review.readiness_score >= 80 ? 'bg-emerald-500'
                : review.readiness_score >= 60 ? 'bg-amber-500'
                : 'bg-rose-500',
            )}
            // Dynamic width can't be expressed in a static Tailwind class
            // (Tailwind purges classes it doesn't see at build time, and a
            // 0–100 runtime score can't be statically enumerated). Inline
            // style is the industry-standard pattern for progress bars.
            // eslint-disable-next-line
            style={{ width: `${review.readiness_score}%` }}
          />
        </div>
      </div>

      {/* 4 review sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
        <ReviewSection label="What's working" tone="green" items={review.whats_working} />
        <ReviewSection label="What's failing" tone="red"   items={review.whats_failing} />
        <ReviewSection label="What to fix"    tone="amber" items={review.whats_to_fix} />
        <ReviewSection label="Risk assessment" tone="blue" items={[review.risk_assessment]} />
      </div>
    </div>
  )
}

function ReviewSection({ label, tone, items }: {
  label: string
  tone:  'green' | 'red' | 'amber' | 'blue'
  items: string[]
}) {
  const toneClasses = {
    green: 'border-emerald-500/30 bg-emerald-500/[0.04]',
    red:   'border-rose-500/30 bg-rose-500/[0.04]',
    amber: 'border-amber-500/30 bg-amber-500/[0.04]',
    blue:  'border-blue-500/30 bg-blue-500/[0.04]',
  }
  return (
    <div className={cn('rounded-lg border p-2.5', toneClasses[tone])}>
      <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-1">{label}</p>
      <ul className="space-y-1 text-foreground/90">
        {items.map((s, i) => (
          <li key={i} className="leading-snug">• {s}</li>
        ))}
      </ul>
    </div>
  )
}

/** Phase 10 — Achievement badge tile. Three visual states:
 *  • Earned        — green tone, full-saturation icon
 *  • In progress   — amber tone, partial-progress ring
 *  • Locked        — gray tone, lock icon
 *  • Blocked       — gray tone + footer reason (e.g. peer data missing)
 */
function AchievementBadge({ a }: { a: Achievement }) {
  // Icon per milestone kind. Lucide chosen to keep the icon family
  // consistent with the rest of the validation center.
  const ICONS: Record<Achievement['kind'], typeof Trophy> = {
    validated_strategy:   Trophy,
    broker_verified:      Shield,
    execution_elite:      Award,
    risk_master:          Zap,
    institutional_trader: Building2,
    top_percentile:       Crown,
    streak_5:             Flame,
    streak_10:            Flame,
    streak_25:            Flame,
    streak_50:            Flame,
  }
  const Icon = a.earned ? ICONS[a.kind] : (a.blocked_reason ? Lock : ICONS[a.kind])

  const tone = a.earned
    ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
    : a.blocked_reason
      ? 'border-border bg-muted/10 opacity-70'
      : (a.progress ?? 0) > 0
        ? 'border-amber-500/30 bg-amber-500/[0.04]'
        : 'border-border bg-muted/5 opacity-70'

  const iconTone = a.earned
    ? 'text-emerald-400'
    : a.blocked_reason
      ? 'text-muted-foreground/50'
      : (a.progress ?? 0) > 0
        ? 'text-amber-300'
        : 'text-muted-foreground/50'

  return (
    <div className={cn('rounded-xl border p-3 transition', tone)}>
      <div className="flex items-start gap-2">
        <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', iconTone)} strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold leading-tight truncate">{a.label}</p>
          <p className={cn(
            'mt-0.5 text-[9px] uppercase tracking-wider font-bold',
            a.earned ? 'text-emerald-400'
              : a.blocked_reason ? 'text-muted-foreground/60'
              : (a.progress ?? 0) > 0 ? 'text-amber-300'
              : 'text-muted-foreground/60',
          )}>
            {a.earned ? 'Earned' : a.blocked_reason ? 'Locked' : a.progress_label ?? 'Locked'}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground/80 leading-snug">
        {a.description}
      </p>

      {/* Progress bar — only when there's meaningful intermediate progress */}
      {a.progress != null && a.progress > 0 && a.progress < 1 && !a.blocked_reason && (
        <div className="mt-2 h-1 w-full rounded-full bg-muted/30 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              a.earned ? 'bg-emerald-500' : 'bg-amber-500',
            )}
            // eslint-disable-next-line
            style={{ width: `${Math.round((a.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      {/* Blocked-reason footer — honest about why a badge can't be earned */}
      {a.blocked_reason && (
        <p className="mt-1.5 text-[9px] italic text-muted-foreground/70 leading-snug">
          {a.blocked_reason}
        </p>
      )}
    </div>
  )
}

/** Phase 4 — inline forensics summary chip rendered in the Recent
 *  Validation Sessions table. Shows grade + composite score; null
 *  forensics rows display a "—" placeholder. Hover reveals the 4
 *  sub-scores via the title attribute. */
function ForensicsCell({ f }: { f: { composite: number; grade: string; entry: number; exec: number; outcome: number; process: number } | null }) {
  if (!f) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground/50">
        <FileSearch className="h-3 w-3" strokeWidth={1.5} aria-hidden />
        <span className="text-[10px]">—</span>
      </span>
    )
  }
  const gradeTone: Record<string, string> = {
    'A': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    'B': 'border-blue-500/40 bg-blue-500/10 text-blue-300',
    'C': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    'D': 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    'F': 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold tabular-nums', gradeTone[f.grade] ?? 'border-border text-muted-foreground')}
      title={`Entry ${f.entry} · Exec ${f.exec} · Outcome ${f.outcome} · Process ${f.process}`}
    >
      {f.grade}<span className="opacity-70">{f.composite}</span>
    </span>
  )
}

/**
 * Lightweight preview rendered behind the lock for free/starter
 * viewers — same shape as the real surface so the upgrade prompt feels
 * honest, but no Supabase data and no real numbers.
 */
function ShadowSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          AI Strategy <span className="text-gradient">Validation Center</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Every strategy must earn the right to trade live.
        </p>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Track Record"        value="Established" tone="plain" />
        <Stat label="Execution Quality"   value="Excellent"   tone="green" />
        <Stat label="Strategy Stability"  value="Stable"      tone="green" />
        <Stat label="Qualification"       value="Qualified"   tone="green" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/10 p-12 text-center text-sm text-muted-foreground">
        Subscribe at Premium to unlock the AI Strategy Validation Center.
      </div>
    </div>
  )
}
