import { AlertOctagon, ShieldAlert, TrendingDown, Repeat, Info, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import PositionSizer from './PositionSizer'
import DailyLossTracker from './DailyLossTracker'
import AutoRiskPanel from '@/components/algo/AutoRiskPanel'
import TierGate from '@/components/algo/TierGate'
import { effectiveTierForFeatures } from '@/lib/demo'
import { analyzeBehavior } from '@/lib/intelligence/behavioral'
import { analyzePerformance } from '@/lib/intelligence/performance'
import { generateInsights, type CoachInsight } from '@/lib/intelligence/coach'
import type { JournalEntry, SubscriptionTier } from '@/lib/types'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Risk Intelligence' }
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30
const RISK_INSIGHT_KINDS = new Set<CoachInsight['kind']>([
  'risk_inflation', 'drawdown', 'discipline', 'consistency',
])

export default async function RiskPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const today  = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const [{ data: profile }, { data: todayTrades }, { data: windowEntries }] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, account_type')
      .eq('id', user!.id)
      .single(),
    supabase
      .from('journal_entries')
      .select('pnl, risk_amount')
      .eq('user_id', user!.id)
      .eq('trade_date', today),
    // Window scan feeds the AI Risk Read banner (same engines as the
    // coach uses on /intelligence/me — single source of truth).
    supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', user!.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  // Demo Pro users see the panel with simulated data
  const userTier = effectiveTierForFeatures(user?.email, rawTier, profile?.account_type)

  const todayPnl    = todayTrades?.reduce((s, t) => s + (t.pnl ?? 0), 0) ?? 0
  const todayRisked = todayTrades?.reduce((s, t) => s + (t.risk_amount ?? 0), 0) ?? 0

  const entries = ((windowEntries ?? []) as unknown as JournalEntry[])
  const behavior    = entries.length > 0 ? analyzeBehavior(entries, WINDOW_DAYS)   : null
  const performance = entries.length > 0 ? analyzePerformance(entries)             : null
  const insights    = (behavior && performance) ? generateInsights(behavior, performance) : []
  const riskInsights = insights.filter((i) => RISK_INSIGHT_KINDS.has(i.kind)).slice(0, 2)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Risk <span className="text-gradient">Intelligence</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI risk read on your last {WINDOW_DAYS} days, plus live position sizing and daily-loss tracking.
        </p>
      </div>

      {/* AI Risk Read — the V3 "Risk Intelligence" layer */}
      <AiRiskRead
        behavior={behavior}
        performance={performance}
        insights={riskInsights}
        entryCount={entries.length}
      />

      {/* Institutional auto risk engine — premium tier only (admin email bypasses) */}
      <TierGate requiredTier="premium" userTier={userTier} upgradeHref="/upgrade" blurContent={false}>
        <AutoRiskPanel />
      </TierGate>

      <div className="grid gap-6 lg:grid-cols-2">
        <PositionSizer />
        <DailyLossTracker todayPnl={todayPnl} todayRisked={todayRisked} todayTrades={todayTrades?.length ?? 0} />
      </div>

      {/* Risk rules reference */}
      <div id="risk-rules" className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Risk Rules Cheatsheet</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            { rule: '1% rule', desc: 'Never risk more than 1% of account per trade' },
            { rule: '3% daily limit', desc: 'Stop trading if down 3% on the day' },
            { rule: '6% weekly limit', desc: 'Take the week off if down 6% total' },
            { rule: 'R:R minimum', desc: 'Only take trades with at least 1.5:1 reward-to-risk' },
            { rule: 'Position sizing', desc: 'Use lot size = (Risk $) ÷ (SL pips × pip value)' },
            { rule: 'Correlation', desc: 'Avoid holding EURUSD + GBPUSD simultaneously (correlated)' },
          ].map((r) => (
            <div key={r.rule} className="rounded-lg bg-muted/40 p-3">
              <p className="font-medium text-xs text-primary">{r.rule}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


// ─── AI Risk Read ────────────────────────────────────────────────────

interface AiRiskReadProps {
  behavior:    ReturnType<typeof analyzeBehavior>    | null
  performance: ReturnType<typeof analyzePerformance> | null
  insights:    CoachInsight[]
  entryCount:  number
}

function AiRiskRead({ behavior, performance, insights, entryCount }: AiRiskReadProps) {
  // No journal data yet — show the onboarding rather than fabricating risk takes.
  if (!behavior || !performance || entryCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">AI Risk Read</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">Waiting on data</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Log a few trades on the <a href="/journal" className="text-amber-300 hover:underline">journal</a> so the risk engine can read your drawdown, drift, and discipline behavior. Position sizing and the daily-loss tracker below work without journal data.
        </p>
      </div>
    )
  }

  const driftScore   = behavior.risk_inflation_risk
  const driftFlags   = behavior.risk_inflation_count
  const disciplineRk = behavior.discipline_risk
  const ruleViols    = behavior.rule_violations
  const ddPct        = performance.max_drawdown_pct
  const worstTrade   = performance.worst_trade

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
        <h2 className="text-sm font-semibold">AI Risk Read</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Last {WINDOW_DAYS} days · {performance.closed_trades} closed
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RiskTile
          label="Risk drift"
          icon={Repeat}
          score={driftScore}
          higherIsBetter={false}
          hint={`${driftFlags} after-win bumps`}
        />
        <RiskTile
          label="Discipline"
          icon={ShieldAlert}
          score={disciplineRk}
          higherIsBetter={false}
          hint={`${ruleViols} rule violations`}
        />
        <RiskTile
          label="Max drawdown"
          icon={TrendingDown}
          score={ddPct != null ? Math.round(ddPct * 100) : null}
          higherIsBetter={false}
          unit="%"
          hint={performance.max_drawdown > 0 ? `−$${performance.max_drawdown.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ''}
        />
        <RiskTile
          label="Worst trade"
          icon={AlertOctagon}
          score={worstTrade != null && worstTrade < 0 ? Math.round(Math.abs(worstTrade)) : null}
          higherIsBetter={false}
          unit="$"
          hint={worstTrade != null && worstTrade < 0 ? 'single-trade loss' : 'no losses yet'}
        />
      </div>

      {insights.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {insights.map((i, idx) => (
            <RiskInsightRow key={idx} i={i} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[12px] text-muted-foreground">
          No risk-specific patterns flagged in this window. Keep logging — the coach surfaces actionable items as soon as sample size supports them.
        </p>
      )}
    </div>
  )
}

function RiskTile({ label, icon: Icon, score, higherIsBetter, unit = '', hint }: {
  label: string
  icon: LucideIcon
  score: number | null
  higherIsBetter: boolean
  unit?: string
  hint?: string
}) {
  if (score == null) {
    return (
      <div className="rounded-lg border border-border/40 bg-background/40 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
        </div>
        <div className="mt-1 text-xs text-muted-foreground/70">Insufficient data</div>
      </div>
    )
  }
  const good = higherIsBetter ? score >= 65 : score <= 25
  const bad  = higherIsBetter ? score < 35  : score >= 60
  const tone = good ? 'text-emerald-300' : bad ? 'text-rose-300' : 'text-amber-300'
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
      </div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums leading-none', tone)}>
        {unit === '$' && score > 0 ? `−$${score}` : `${score}${unit}`}
        {unit === '' && <span className="text-[11px] opacity-50">/100</span>}
      </div>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

function RiskInsightRow({ i }: { i: CoachInsight }) {
  const tone = {
    info:     'border-border bg-card/60 text-foreground/85',
    good:     'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200',
    warn:     'border-amber-500/40 bg-amber-500/[0.06] text-amber-200',
    critical: 'border-rose-500/50 bg-rose-500/[0.06] text-rose-200',
  }[i.severity]
  const Icon = i.severity === 'info' ? Info : AlertOctagon
  return (
    <li className={cn('rounded-lg border p-3', tone)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug">{i.headline}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{i.detail}</p>
          {i.evidence && (
            <p className="mt-1 font-mono text-[10px] tabular-nums opacity-70">{i.evidence}</p>
          )}
        </div>
      </div>
    </li>
  )
}
