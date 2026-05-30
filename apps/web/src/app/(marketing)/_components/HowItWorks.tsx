import { PlugZap, Brain, FlaskConical, Rocket } from 'lucide-react'

/**
 * V3 trader journey: CONNECT → ANALYZE → VALIDATE → EXECUTE.
 *
 * Was a 3-step "from signal to execution" funnel that implied copy-trading
 * ("auto-mirror trades, shadow-validated before going live"). Copy-trading
 * was retired in R7; the four-stage trader-intelligence journey replaces it.
 */
const STEPS = [
  {
    icon: PlugZap,
    title: 'Connect',
    body: 'Link a broker (MT4/MT5/cTrader/Binance/Bybit/OKX) so trades auto-import into the journal. Keys are AES-256-GCM encrypted; withdrawal scope stays disabled.',
  },
  {
    icon: Brain,
    title: 'Analyze',
    body: 'Each trade is scored on 5 process axes (Execution / Psychology / Risk / Discipline / Timing) and gets 3+ AI insights — "cap risk on EURUSD at 0.5%" rather than generic warnings.',
  },
  {
    icon: FlaskConical,
    title: 'Validate',
    body: 'Use the Strategy Lab — Quant Builder, Backtester with realistic per-asset costs, Monte Carlo with sample-size confidence, and the Deployment Readiness ladder before you size up.',
  },
  {
    icon: Rocket,
    title: 'Execute',
    body: 'When a strategy clears Pilot stage, deploy it through the 15-gate institutional risk system. Engine pulse, live positions and logs surface on the Automation Monitor.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-14 sm:py-20">
      <div className="mb-10 text-center sm:mb-12">
        <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
          The trader journey
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          Connect &middot; Analyze &middot; Validate &middot; <span className="text-gradient">Execute</span>
        </h2>
      </div>

      <ol className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          return (
            <li
              key={s.title}
              className="relative rounded-2xl border border-border bg-card p-5 sm:p-6"
            >
              <span className="absolute right-4 top-4 text-4xl font-extrabold leading-none text-muted-foreground/10">
                {i + 1}
              </span>
              <Icon className="h-7 w-7 text-amber-300/90" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-3 text-base font-bold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
