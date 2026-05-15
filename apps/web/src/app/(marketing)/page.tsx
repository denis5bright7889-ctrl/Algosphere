import { PLANS } from '@/lib/stripe/plans'
import LeadCaptureForm from '@/components/marketing/LeadCaptureForm'
import PricingCard from '@/components/marketing/PricingCard'
import FeatureMatrix from '@/components/marketing/FeatureMatrix'
import Logo from '@/components/brand/Logo'

export const metadata = {
  title: 'AlgoSphere Quant — Professional Trading Signals & Analytics',
  description:
    'Get daily trading signals, risk management tools, and a trade journal — all in one platform. Start free, upgrade when ready.',
}

const FEATURES = [
  {
    icon: '📡',
    title: 'Daily Trading Signals',
    description:
      'Receive curated buy/sell signals for Forex and Gold with entry, SL, and multiple TPs.',
  },
  {
    icon: '🛡️',
    title: 'Risk Management',
    description:
      'Position size calculator, daily loss tracker, and risk/reward visualiser built-in.',
  },
  {
    icon: '📓',
    title: 'Trade Journal',
    description:
      'Log trades with screenshots, tags, and notes. Automatically calculate win rate and P&L.',
  },
  {
    icon: '📊',
    title: 'Analytics Dashboard',
    description:
      'Track performance by pair, setup, and time period. Identify what works for your style.',
  },
  {
    icon: '🤖',
    title: 'Telegram & WhatsApp Bot',
    description: 'Receive signals and account alerts directly in Telegram or WhatsApp.',
  },
  {
    icon: '🌍',
    title: 'Africa-Friendly Payments',
    description: 'Pay via M-Pesa, mobile money, bank transfer, card, or crypto — no USD card needed.',
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

const SOCIAL_PROOF = [
  { name: 'James O.', role: 'Forex trader, Nigeria', quote: 'The signals are clean and the risk dashboard saved me from over-leveraging twice already.' },
  { name: 'Sarah M.', role: 'Part-time trader, Kenya', quote: 'M-Pesa payment made it easy. The Telegram bot alerts are fast — I never miss an entry.' },
  { name: 'David K.', role: 'Prop firm funded, Ghana', quote: 'The journal and analytics helped me identify that I was losing on reversal setups. Fixed that, now profitable.' },
]

export default function HomePage() {
  return (
    <div className="bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Logo size="sm" alt="" priority />
            <span>
              <span className="text-gradient">AlgoSphere</span> Quant
            </span>
          </a>
          <nav className="hidden gap-6 text-sm md:flex">
            <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground">Pricing</a>
            <a href="#faq" className="text-muted-foreground hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Sign in
            </a>
            <a
              href="/signup"
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Start free
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl px-4 pt-16 pb-16 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh pointer-events-none" aria-hidden />
        <div className="relative">
          <div className="flex justify-center mb-6 animate-fade-in">
            <Logo size="xl" priority />
          </div>
          <span className="inline-block rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
            7-day free trial — no card required
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
            Where{' '}
            <span className="text-gradient">algorithms</span>{' '}
            meet alpha
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
            Daily Forex &amp; Gold signals, institutional risk management, and a trade journal — all
            in one platform built for African and global retail traders.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="/signup"
              className="btn-premium w-full sm:w-auto !px-8 !py-3 !text-base"
            >
              Start free trial
            </a>
            <a
              href="#features"
              className="btn-glass w-full sm:w-auto !px-8 !py-3 !text-base"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Pay via M-Pesa, card, bank transfer, or crypto
          </p>
        </div>
      </section>

      {/* Stats bar */}
      <div className="border-y border-border bg-muted/40 py-6">
        <div className="mx-auto max-w-4xl grid grid-cols-3 gap-4 px-4 text-center">
          {[
            { label: 'Win rate (30d)', value: '71%' },
            { label: 'Signals/month', value: '80+' },
            { label: 'Active traders', value: '500+' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <section id="features" className="mx-auto max-w-5xl px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold">Everything you need to trade consistently</h2>
          <p className="mt-3 text-muted-foreground">
            One subscription. All the tools. No spreadsheets needed.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 space-y-2"
            >
              <span className="text-2xl">{f.icon}</span>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Social proof */}
      <section className="bg-muted/40 border-y border-border py-16">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="text-center text-2xl font-bold mb-10">Traders who switched</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {SOCIAL_PROOF.map((t) => (
              <div key={t.name} className="rounded-xl bg-card border border-border p-6 space-y-3">
                <p className="text-sm text-muted-foreground italic">&ldquo;{t.quote}&rdquo;</p>
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center mb-12">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            Upgrade your plan
          </span>
          <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
            Choose the perfect <span className="text-gradient">AI trading package</span>
          </h2>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
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
      <section id="faq" className="bg-muted/40 border-y border-border py-16">
        <div className="mx-auto max-w-2xl px-4">
          <h2 className="text-center text-2xl font-bold mb-10">Frequently asked questions</h2>
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
      <section className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-2xl font-bold">Get a free signal to your inbox</h2>
        <p className="mt-2 mb-6 text-muted-foreground text-sm">
          Join 500+ traders. One email per week. Unsubscribe any time.
        </p>
        <LeadCaptureForm />
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} AlgoSphere Quant. Trading involves risk — signals are educational, not financial advice.</p>
        <div className="mt-2 flex justify-center gap-4">
          <a href="/terms" className="hover:underline">Terms</a>
          <a href="/privacy" className="hover:underline">Privacy</a>
        </div>
      </footer>
    </div>
  )
}
