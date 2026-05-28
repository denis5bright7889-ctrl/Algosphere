import {
  Radar, ShieldCheck, ScrollText, BarChart3, Cpu, Globe,
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
  title: 'AlgoSphere Quant — Institutional Market Intelligence & Execution Infrastructure',
  description:
    'A quantitative trading operating system: market regime, smart-money flow, liquidity and conviction intelligence, AI-assisted execution and a 12-gate risk engine. Built for serious traders, quants and desks.',
}

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Radar,
    title: 'Market Intelligence Engine',
    description:
      'Regime, momentum, liquidity, smart-money flow and conviction — institutional market states across FX, metals, equities and crypto. No raw indicators; just intelligence.',
  },
  {
    icon: ShieldCheck,
    title: 'Institutional Risk Engine',
    description:
      'Position sizing, daily-loss and drawdown limits, kill-switch and a 12-gate capital guard.',
  },
  {
    icon: ScrollText,
    title: 'Trade Journal',
    description:
      'Log trades with screenshots, tags and notes. Win rate, R:R and P&L computed automatically.',
  },
  {
    icon: BarChart3,
    title: 'Performance Analytics',
    description:
      'Break down results by pair, setup, session and regime. See exactly what edges hold.',
  },
  {
    icon: Cpu,
    title: 'Live Execution',
    description: 'Auto-mirror signals to Binance, Bybit, OKX or MT5 — shadow-validated before going live.',
  },
  {
    icon: Globe,
    title: 'Multi-Channel Delivery',
    description: 'Signals and account alerts via Web Push, email and Telegram — never miss an entry.',
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
    q: 'How accurate are the signals?',
    a: 'Our signals are based on multi-timeframe technical analysis. Historical win rate is displayed live in the analytics dashboard — we show the truth, not cherry-picked results.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from your billing settings at any time and your plan remains active until the end of the billing period. No lock-ins.',
  },
  {
    q: 'Which markets do you cover?',
    a: 'We focus on Gold (XAUUSD), major Forex pairs (EURUSD, GBPUSD, USDJPY), and selected indices. More pairs are added based on demand.',
  },
  {
    q: 'Do I need a specific broker?',
    a: 'No — signals include entry, SL, and TP levels that you enter manually on any broker. A copy-trading bridge (MT4/MT5) is on the roadmap.',
  },
  {
    q: 'Is there a free plan?',
    a: 'Yes. The free tier gives you 3 signals per week, a dashboard preview, and access to the Telegram community. Upgrade for daily signals and full features.',
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
              Institutional AI · live regime engine
            </span>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Where{' '}
              <span className="text-gradient">algorithms</span>
              <br className="hidden sm:inline" />
              meet alpha
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg mx-auto lg:mx-0">
              Market regime, smart-money flow, liquidity and conviction intelligence,
              AI-assisted execution and a 12-gate risk engine — one quantitative
              operating system, not a signals feed.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <a href="/signup" className="btn-premium w-full sm:w-auto !px-8 !py-3 !text-base">
                Start free trial
              </a>
              <a href="#features" className="btn-glass w-full sm:w-auto !px-8 !py-3 !text-base">
                See how it works
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              7-day free trial · no card required
            </p>
          </div>

          {/* RIGHT — honest live-engine card (replaces the prior simulated-tape preview;
              no fake candles, no fabricated AI badge — visitors are routed to /live,
              which is the actual engine running). */}
          <aside className="rounded-2xl border border-border bg-card/40 p-6 md:p-8">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                Engine live
              </span>
            </div>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
              30 institutional instruments<br />scanning right now.
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Forex · gold · silver · platinum · palladium · WTI · Brent · 14 crypto.
              Regime, weighted ensemble, risk-gated signal generation — published
              only when conviction clears institutional thresholds.
            </p>
            <a href="/live"
               className="mt-6 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-4 py-2 text-sm font-bold text-amber-300 hover:bg-amber-500/10">
              See the engine working →
            </a>
            <p className="mt-3 text-[11px] text-muted-foreground">
              No simulated tape. No fake AI signals. Honest by construction.
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
          <h2 className="text-2xl font-bold sm:text-3xl">Everything you need to trade consistently</h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            One subscription. All the tools. No spreadsheets needed.
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
        </div>
      </footer>

      {/* Sticky mobile conversion bar */}
      <MobileCtaBar />

      {/* Captures ?ref= into a cookie so attribution survives navigation. */}
      <RefCookieCapture />
    </div>
  )
}
