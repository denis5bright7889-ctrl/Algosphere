/**
 * Public Validation Showcase — Phase 11 of the Validation Center.
 *
 * Marketing surface at /validation. NO auth required — anyone can
 * read this page. It surfaces the cross-platform validation
 * aggregate from public-validation-stats with the strict honesty
 * contract baked in (sample-gated, anonymised, every metric carries
 * a confidence label).
 *
 * If the cross-user sample is below threshold we show a "we're
 * still building sample" banner instead of metrics — never invented
 * numbers on a public page.
 *
 * Cache: revalidate every 30 minutes. The aggregator hits Supabase
 * with a service-role client; we don't want every visit to fan out.
 */
import Link from 'next/link'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import {
  aggregatePublicValidationStats, PUBLIC_MIN_TRADES, PUBLIC_MIN_USERS,
  type PublicMetric,
} from '@/lib/intelligence/public-validation-stats'
import {
  ShieldCheck, Activity, Gauge, BarChart3, AlertTriangle, CheckCircle2, Info,
} from 'lucide-react'

export const metadata = {
  title:       'Strategy Validation — AlgoSphere Quant',
  description:
    'Every strategy must earn the right to trade live. See how AlgoSphere validates execution quality, broker performance, and strategy readiness using forward-tested market data — sample-gated, anonymised, never fabricated.',
}

// Force dynamic rendering — the aggregator hits Supabase with the
// service role key, which is a RUNTIME env var. Static prerender at
// build time would crash with "supabaseKey is required" because the
// key isn't bundled into the build. The 30-min cache below ISR-style
// is implemented via `unstable_cache` later if needed; for now we
// render on demand.
export const dynamic  = 'force-dynamic'
export const revalidate = 0

export default async function PublicValidationPage() {
  const stats = await aggregatePublicValidationStats()

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-sm font-bold">AlgoSphere Quant</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/pricing"  className="text-muted-foreground hover:text-foreground">Pricing</Link>
            <Link href="/blog"     className="text-muted-foreground hover:text-foreground">Blog</Link>
            <Link href="/login"    className="text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link
              href="/signup"
              className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <p className="text-[11px] uppercase tracking-widest font-bold text-amber-300 mb-3">
            AI Strategy Validation Center
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight max-w-3xl">
            Every strategy must earn the right to <span className="text-gradient">trade live.</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-2xl">
            AlgoSphere validates execution quality, broker performance, and strategy
            readiness on forward-tested market data before any capital is exposed.
            This page surfaces the live cross-platform validation aggregate —
            sample-gated, anonymised, never fabricated.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
            <Pill icon={<ShieldCheck className="h-3 w-3" />} label="No fabricated metrics" tone="green" />
            <Pill icon={<Info className="h-3 w-3" />}        label="Sample-gated" tone="blue" />
            <Pill icon={<CheckCircle2 className="h-3 w-3" />} label="Anonymised" tone="green" />
          </div>
        </div>
      </section>

      {/* Stats grid OR honest pre-threshold banner */}
      <section className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-widest">
              Live Validation Statistics
            </h2>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              Generated {new Date(stats.generated_at).toLocaleString()} ·{' '}
              {stats.contributing_users} contributing users ·{' '}
              {stats.contributing_brokers} broker{stats.contributing_brokers === 1 ? '' : 's'}
            </p>
          </div>

          {!stats.meets_global_threshold && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-100">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-300" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="font-bold uppercase tracking-wider text-xs mb-1 text-amber-300">
                  Sample Below Activation Threshold
                </p>
                <p className="text-[13px] leading-relaxed">
                  AlgoSphere doesn't publish cross-platform outcome metrics until the validation
                  cohort reaches <span className="font-semibold">{PUBLIC_MIN_TRADES.toLocaleString()} closed
                  shadow trades</span> across <span className="font-semibold">{PUBLIC_MIN_USERS}+ contributing users</span>.
                  Currently <span className="font-semibold">{stats.contributing_users}</span> users and{' '}
                  <span className="font-semibold">{stats.trades_analysed.numeric ?? 0}</span> logged executions.
                  Below threshold every cell shows "Insufficient sample" rather than a misleading number.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              icon={<ShieldCheck className="h-5 w-5" />}
              label="Strategies Validated"
              metric={stats.strategies_validated}
              tone="green"
            />
            <MetricCard
              icon={<Activity className="h-5 w-5" />}
              label="Trades Analysed"
              metric={stats.trades_analysed}
              tone="blue"
            />
            <MetricCard
              icon={<BarChart3 className="h-5 w-5" />}
              label="Broker Accuracy"
              metric={stats.broker_accuracy}
              tone="green"
            />
            <MetricCard
              icon={<Gauge className="h-5 w-5" />}
              label="Average Slippage"
              metric={stats.average_slippage}
              tone="amber"
              invertGood
            />
            <MetricCard
              icon={<AlertTriangle className="h-5 w-5" />}
              label="Risk Metrics (Median)"
              metric={stats.risk_metrics}
              tone="amber"
            />
            <MetricCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Validation Success Rate"
              metric={stats.validation_success_rate}
              tone="green"
            />
          </div>

          <p className="mt-5 text-[11px] text-muted-foreground/80 leading-relaxed">
            <strong className="text-foreground">Methodology:</strong> All cross-platform metrics are derived from
            shadow_executions records that pass three honesty gates: (1) total cross-user closed trades ≥{' '}
            {PUBLIC_MIN_TRADES}, (2) ≥ {PUBLIC_MIN_USERS} contributing users, (3) per-metric minimum sample
            (e.g. 3 graded brokers for Broker Accuracy, 10 reviewed strategies for Validation Success Rate). No
            individual broker, strategy, or user is identifiable in the output. Confidence labels:{' '}
            <strong className="text-emerald-400">tight</strong> (large sample),{' '}
            <strong className="text-amber-300">wide</strong> (small but valid),{' '}
            <strong className="text-muted-foreground">suppressed</strong> (below threshold).
          </p>
        </div>
      </section>

      {/* How validation works */}
      <section className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-5">How AlgoSphere validates</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StepCard
              n={1}
              title="Shadow Execution"
              body="Every full-auto signal is recorded with intent + outcome against a simulated/testnet fill. No live capital is exposed."
            />
            <StepCard
              n={2}
              title="Five-Stage Gate"
              body="Signal Validation → Execution Validation → Risk Validation → Live Qualification → Deployment Ready. Each stage has hard thresholds."
            />
            <StepCard
              n={3}
              title="AI Strategy Coach"
              body="Deterministic coach reviews every graded strategy — readiness score, grade, recommendation. No LLM hallucination."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            See your own strategies in the Validation Center.
          </h2>
          <p className="mb-6 text-sm text-muted-foreground max-w-xl mx-auto">
            Subscribe to a published strategy in full-auto mode and your shadow executions populate
            your private validation dashboard. Live unlock only after the 5-stage gate clears.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90"
          >
            Get Started →
          </Link>
        </div>
      </section>
    </main>
  )
}

function Pill({ icon, label, tone }: {
  icon: React.ReactNode
  label: string
  tone: 'green' | 'blue' | 'amber'
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-bold',
      tone === 'green' && 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300',
      tone === 'blue'  && 'border-blue-500/30 bg-blue-500/[0.06] text-blue-300',
      tone === 'amber' && 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300',
    )}>
      {icon}
      {label}
    </span>
  )
}

function MetricCard({ icon, label, metric, tone, invertGood = false }: {
  icon: React.ReactNode
  label: string
  metric: PublicMetric
  tone: 'green' | 'blue' | 'amber'
  invertGood?: boolean
}) {
  void invertGood   // reserved for tone-driven highlight in a follow-up
  const isSuppressed = metric.confidence === 'suppressed'
  return (
    <div className={cn(
      'rounded-2xl border bg-card p-5',
      isSuppressed
        ? 'border-border/60 opacity-80'
        : tone === 'green' ? 'border-emerald-500/30'
        : tone === 'blue'  ? 'border-blue-500/30'
        : 'border-amber-500/30',
    )}>
      <div className="flex items-center gap-2 mb-3">
        <span className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg',
          isSuppressed
            ? 'bg-muted/30 text-muted-foreground'
            : tone === 'green' ? 'bg-emerald-500/15 text-emerald-300'
            : tone === 'blue'  ? 'bg-blue-500/15 text-blue-300'
            : 'bg-amber-500/15 text-amber-300',
        )}>
          {icon}
        </span>
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{label}</p>
      </div>

      <p className={cn(
        'text-2xl font-bold tabular-nums',
        isSuppressed && 'text-muted-foreground',
      )}>
        {metric.value}
      </p>

      <p className="mt-2 text-[11px] text-muted-foreground/85 leading-snug">
        {metric.detail}
      </p>

      <div className="mt-3 flex items-center gap-1.5 text-[9px] uppercase tracking-wider font-bold">
        <span className={cn(
          'rounded px-1.5 py-0.5',
          metric.confidence === 'tight'    && 'bg-emerald-500/10 text-emerald-300',
          metric.confidence === 'wide'     && 'bg-amber-500/10  text-amber-300',
          metric.confidence === 'suppressed' && 'bg-muted/30    text-muted-foreground',
        )}>
          {metric.confidence}
        </span>
        {metric.sample_size > 0 && !isSuppressed && (
          <span className="text-muted-foreground/70 tabular-nums">
            n = {metric.sample_size.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}

function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-[10px] uppercase tracking-wider font-bold text-amber-300 mb-2">
        Step {n}
      </p>
      <p className="text-base font-bold mb-1.5">{title}</p>
      <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  )
}
