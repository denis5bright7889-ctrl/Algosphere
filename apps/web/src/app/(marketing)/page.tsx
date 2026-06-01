import {
  Radar, ShieldCheck, BookOpen, BarChart3, Brain, FlaskConical,
  ShieldHalf, LineChart, Lock, type LucideIcon,
} from 'lucide-react'
import { PLANS } from '@/lib/plans'
import LeadCaptureForm from '@/components/marketing/LeadCaptureForm'
import PricingCard from '@/components/marketing/PricingCard'
import FeatureMatrix from '@/components/marketing/FeatureMatrix'
import Card from '@/components/ui/Card'
import RegimeStrip from './_components/RegimeStrip'
import MarketTickerStrip from '@/components/market/MarketTickerStrip'
import MarketingNav from './_components/MarketingNav'
import StatsBand from './_components/StatsBand'
import HowItWorks from './_components/HowItWorks'
import MobileCtaBar from './_components/MobileCtaBar'
import RefCookieCapture from '@/components/marketing/RefCookieCapture'

export const metadata = {
  title: 'AlgoSphere Quant — AI Trader Intelligence Operating System',
  description:
    'An AI Trader Intelligence OS: behavioral trade journal with 5 process grades, AI Coach, Strategy Lab (Quant Builder + Backtester + Optimization), consolidated market intelligence, 15-gate institutional risk. Built for serious retail and prosumer traders.',
}

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: BookOpen,
    title: 'Behavioral Trade Journal',
    description:
      'Every trade is a decision event — auto-imported from your broker or logged manually. Each entry generates 5 process grades (Execution / Psychology / Risk / Discipline / Timing) plus 3+ AI insights. PnL never grades; process does.',
  },
  {
    icon: Brain,
    title: 'AI Coach',
    description:
      'Streak-aware, pair-specific recommendations. "Cap risk on EURUSD at 0.5%" rather than generic warnings. Reads your behavior in real time and tells you the next concrete fix.',
  },
  {
    icon: FlaskConical,
    title: 'Strategy Lab',
    description:
      'Visual Quant Builder (18 blocks · SMC + indicators + session filters), realistic-cost Backtester, Monte Carlo with sample-size confidence, Optimization Center with edge-stability scoring, and a 6-stage Deployment Readiness ladder (Research → Institutional).',
  },
  {
    icon: Radar,
    title: 'Consolidated Market Intelligence',
    description:
      'Regime · liquidity & flows · sentiment · rotation · momentum · volatility & stress — one decision surface for 34+ instruments across forex, metals, indices, oil and crypto. No raw indicators dumped on you.',
  },
  {
    icon: ShieldCheck,
    title: '15-Gate Institutional Risk',
    description:
      'Position sizing, daily/weekly/total drawdown, consecutive-loss cooldown, kill switch, news shield, correlation cap, session limits — every signal pre-checked before publishing.',
  },
  {
    icon: BarChart3,
    title: 'Performance Intelligence',
    description:
      'Sharpe / Sortino / Calmar, drawdown clustering, per-pair / per-session / per-setup edges, equity curve, monthly attribution. Find where your edge lives — and where it leaks.',
  },
]

const TRUST: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: ShieldHalf,
    title: 'Shadow-validated execution',
    description: 'No connection goes live until 50+ executions prove ≥95% fill, <0.1% slippage and <2% drift.',
  },
  {
    icon: LineChart,
    title: 'Truthful performance',
    description: 'Win rate is computed from real closed trades and shown live — never cherry-picked.',
  },
  {
    icon: Lock,
    title: 'Encrypted credentials',
    description: 'Broker API keys are AES-256-GCM encrypted at the app layer; withdrawal scope stays disabled.',
  },
]

const FAQS = [
  {
    q: 'What actually is AlgoSphere?',
    a: 'An AI Trader Intelligence Operating System. The flagship surface is the Behavioral Trade Journal that scores every trade on 5 process axes (Execution / Psychology / Risk / Discipline / Timing) and generates AI insights. Around it sit a consolidated Market Intelligence read, an AI Coach that gives pair-specific recommendations, a Strategy Lab (Quant Builder + Backtester + Optimization), and a 15-gate institutional risk system. Signals exist but are a feature, not the lead.',
  },
  {
    q: 'Do I have to be auto-trading to get value?',
    a: 'No. Most users connect a broker so trades auto-import into the journal — the AI Coach reads the resulting behavior and tells you what to fix. Live execution is opt-in on premium tiers; the intelligence layer works whether or not you wire it.',
  },
  {
    q: 'Which markets does the engine cover?',
    a: 'The signal engine currently scans 34+ instruments across Forex majors (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCHF, USDCAD, NZDUSD, EURJPY), metals (Gold, Silver, Platinum, Palladium), oil (WTI, Brent), indices (NAS100, SPX500, GER40, UK100, JPN225), and crypto majors (BTC, ETH, SOL, XRP, ADA, DOGE, AVAX, LINK, LTC, DOT, and more). The Behavioral Journal works on any pair you log.',
  },
  {
    q: 'Which brokers can I connect?',
    a: 'MetaTrader 4, MetaTrader 5, cTrader, Binance, Bybit, OKX. Broker API keys are AES-256-GCM encrypted at the app layer; withdrawal scope stays disabled. Adding a broker auto-imports your fills into the Behavioral Journal.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from billing settings at any time; your plan stays active to the end of the billing period. No lock-ins. Payment is crypto-only (USDT-TRC20 + BTC/ETH/Binance Pay).',
  },
  {
    q: 'Is there a free plan?',
    a: 'Yes. The free tier gives you 3 AI signals per week, the Trader Intelligence dashboard preview, and access to the curated Telegram channels. Upgrade for the full Behavioral Journal, Performance Intelligence, AI Coach, and Strategy Lab.',
  },
]


export default function HomePage() {
  return (
    <div className="bg-background text-foreground">
      {/* Nav — desktop links + mobile hamburger drawer */}
      <MarketingNav />

      {/* Hero — 2-column on desktop, stacked on mobile */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh pointer-events-none" aria-hidden />
        {/* Cinematic ambient gradients */}
        <div className="pointer-events-none absolute -top-32 left-1/4 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 right-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden />

        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 pb-16 lg:grid-cols-2 lg:gap-12 lg:pt-20 lg:pb-24">
          {/* LEFT — copy + CTAs */}
          <div className="text-center lg:text-left animate-fade-in">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
              AI Trader Intelligence Operating System
            </span>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Understand{' '}
              <span className="text-gradient">your edge</span>.
              <br className="hidden sm:inline" />
              Build the next one.
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg mx-auto lg:mx-0">
              Every trade scored on 5 process axes. An AI Coach that tells you the
              next concrete fix. A Strategy Lab to test what works. Built for traders
              who want to improve, not just receive signals.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <a href="/signup" className="btn-premium w-full sm:w-auto !px-8 !py-3 !text-base">
                Start free trial
              </a>
              <a href="#features" className="btn-glass w-full sm:w-auto !px-8 !py-3 !text-base">
                See what&apos;s inside
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              7-day free trial · no card required · crypto-only billing
            </p>
          </div>

          {/* RIGHT — honest live-engine card. No simulated tape, no fabricated
              AI badge — visitors route to /live to inspect the actual engine
              + /journal to see the Behavioral Journal in action. */}
          <aside className="rounded-2xl border border-border bg-card/40 p-6 md:p-8">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                Trader Intelligence — live
              </span>
            </div>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
              34+ instruments scanned.<br />
              <span className="text-gradient">Every trade graded.</span>
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Forex majors · metals · oil · indices · 14+ crypto. Each signal pre-checked
              by a 15-gate risk system. Each trade you log scored on 5 process axes —
              never on P&amp;L alone.
            </p>
            <a href="/live"
               className="mt-6 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-4 py-2 text-sm font-bold text-amber-300 hover:bg-amber-500/10">
              See the engine working →
            </a>
            <p className="mt-3 text-[11px] text-muted-foreground">
              No simulated tape. No fake AI badges. Honest by construction.
            </p>
          </aside>
        </div>
      </section>

      {/* Real-exchange price tape — first thing every visitor sees ticking */}
      <MarketTickerStrip />

      {/* Live market regime strip — categorical AI bias */}
      <RegimeStrip />

      {/* Honest credibility band — real source-of-truth scale numbers */}
      <StatsBand />

      {/* Features */}
      <section id="features" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-14 sm:py-20">
        <div className="mb-10 text-center sm:mb-12">
          <h2 className="text-2xl font-bold sm:text-3xl">
            One decision intelligence system, not six tools
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Every layer reads the same data: your trades. The journal grades them, the
            coach reads the grades, the Strategy Lab tests new ones, the risk engine guards them.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <Card key={f.title} variant="brand" pad="lg" interactive className="space-y-3">
                <Icon className="h-6 w-6 text-amber-300/90" strokeWidth={1.75} aria-hidden />
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </Card>
            )
          })}
        </div>
      </section>

      {/* How it works — 3-step comprehension aid */}
      <HowItWorks />

      {/* Trust band — factual platform guarantees, not fabricated testimonials */}
      <section className="border-y border-border bg-muted/30 py-14 sm:py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="mb-2 text-center text-2xl font-bold tracking-tight">
            Built to <span className="text-gradient">institutional standards</span>
          </h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-muted-foreground">
            No paid reviews, no invented track records. These are guarantees enforced in the code.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {TRUST.map((t) => {
              const Icon = t.icon
              return (
                <Card key={t.title} variant="glass" pad="lg" className="space-y-3">
                  <Icon className="h-6 w-6 text-amber-300/90" strokeWidth={1.75} aria-hidden />
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                </Card>
              )
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:py-20">
        <div className="mb-10 text-center sm:mb-12">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            Upgrade your plan
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-4xl">
            Choose the perfect <span className="text-gradient">AI trading package</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Three institutional-grade tiers. Try any with a free demo — no card required.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {Object.values(PLANS).filter(p => p.id !== 'free').map((plan) => (
            <PricingCard key={plan.id} plan={plan} />
          ))}
        </div>

        <p className="mt-10 mb-2 text-center text-sm text-muted-foreground">
          Full feature comparison
        </p>
        <FeatureMatrix />
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-y border-border bg-muted/40 py-14 sm:py-16">
        <div className="mx-auto max-w-2xl px-4">
          <h2 className="mb-8 text-center text-2xl font-bold sm:mb-10">Frequently asked questions</h2>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="rounded-xl border border-border bg-card px-5 py-4 group open:pb-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                  {faq.q}
                  <span className="ml-4 text-muted-foreground group-open:rotate-180 transition-transform">
                    ▾
                  </span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Lead capture */}
      <section className="mx-auto max-w-xl px-4 py-14 text-center sm:py-20">
        <h2 className="text-2xl font-bold">Get a free signal to your inbox</h2>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Join the trader list. One email per week. Unsubscribe any time.
        </p>
        <LeadCaptureForm />
      </section>

      {/* Footer — extra bottom space on mobile so the sticky CTA never overlaps */}
      <footer className="border-t border-border py-8 pb-28 text-center text-xs text-muted-foreground md:pb-8">
        <p>© {new Date().getFullYear()} AlgoSphere Quant. Trading involves risk — signals are educational, not financial advice.</p>
        <div className="mt-2 flex justify-center gap-4">
          <a href="/terms" className="hover:underline">Terms</a>
          <a href="/privacy" className="hover:underline">Privacy</a>
          <a href="/data-deletion" className="hover:underline">Data Deletion</a>
        </div>
      </footer>

      {/* Sticky mobile conversion bar */}
      <MobileCtaBar />

      {/* Captures ?ref= into a cookie so attribution survives navigation. */}
      <RefCookieCapture />
    </div>
  )
}
