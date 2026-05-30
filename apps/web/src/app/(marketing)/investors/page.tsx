/**
 * /investors — public, honest pitch artifact.
 *
 * Built for outreach: a link you can send to anyone (angel, supporter,
 * accelerator, journalist) so they can evaluate the product in 60 seconds.
 * Honest by construction — only claims that are visibly true on the live
 * system. No fake traction, no inflated metrics. Engineering shipped to
 * date, what's needed, and how to talk.
 */
import Link from 'next/link'

export const metadata = {
  title: 'Investors & Supporters — AlgoSphere Quant',
  description:
    'AlgoSphere Quant is an AI Trader Intelligence Operating System shipped end-to-end by a solo founder. Behavioral journal, 5-axis trade grading, AI coach, Strategy Lab, consolidated market intelligence, 15-gate institutional risk. Open to supporters and angel investors.',
  alternates: { canonical: '/investors' },
  openGraph: {
    type: 'website',
    title: 'AlgoSphere Quant — for investors & supporters',
    description:
      'AI Trader Intelligence Operating System shipped end-to-end by a solo founder. Real engineering, live system, honest traction. Open to supporters.',
    url: '/investors',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AlgoSphere Quant — for investors & supporters',
    description: 'AI Trader Intelligence Operating System shipped end-to-end by a solo founder.',
  },
}

export const dynamic = 'force-dynamic'

export default function InvestorsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 md:py-16">
      <header className="space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">For investors &amp; supporters</p>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          An AI Trader Intelligence Operating System, <span className="text-gradient">shipped end-to-end</span> by one founder.
        </h1>
        <p className="text-base text-muted-foreground md:text-lg">
          AlgoSphere Quant teaches retail traders about themselves: every trade is
          scored on 5 process axes, an AI Coach gives pair-specific recommendations,
          a Strategy Lab tests new edges, and a 15-gate institutional risk system
          guards execution. Live, working, inspectable. Built by a solo founder.
          Open to supporters who back early product over polished pitch decks.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/live"
                className="rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-bold text-black shadow-glow-gold">
            See the engine live →
          </Link>
          <a href="mailto:denis5bright7889@gmail.com?subject=AlgoSphere%20Quant%20%E2%80%94%20investor%20interest"
             className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:border-amber-500/40">
            Talk to the founder
          </a>
        </div>
      </header>

      <Section title="The problem">
        <p>
          Retail traders pay for noise. The signals industry sells lottery
          tickets — opaque indicators, untracked outcomes, no behavioral feedback,
          no risk gates. Meanwhile, real institutional desks run consolidated
          intelligence and treat every trade as a decision event with structured
          process data. That feedback loop is locked inside hedge funds.
        </p>
      </Section>

      <Section title="The product">
        <p>
          AlgoSphere Quant is an AI Trader Intelligence Operating System.
          Every trade — manually logged or auto-imported from a broker — is
          scored on 5 process axes (Execution / Psychology / Risk / Discipline /
          Timing), generating 3+ AI insights per entry. An AI Coach reads the
          resulting behavior in real time. A Strategy Lab (Quant Builder +
          Backtester + Optimization Center) lets traders test what works before
          deploying. A 15-gate institutional risk system guards execution.
          Signals exist but are a feature, not the lead.
        </p>
      </Section>

      <Section title="What's actually built (verifiable on the live site)">
        <ul className="grid gap-3 sm:grid-cols-2">
          <Bullet>Behavioral Trade Journal — 5 process grades per trade + 3+ AI insights, structured Strategy + Psychology context required</Bullet>
          <Bullet>AI Coach — streak-aware, pair-specific recommendations (&quot;cap risk on EURUSD at 0.5%&quot;)</Bullet>
          <Bullet>Strategy Lab — visual Quant Builder (18 blocks · SMC + indicators), Backtester with realistic per-asset costs, Monte Carlo with sample-size confidence, Optimization Center, Deployment Readiness ladder (6 stages)</Bullet>
          <Bullet>Consolidated Market Intelligence — 6 thematic sections (Regime · Liquidity &amp; Flows · Sentiment · Rotation · Momentum · Volatility &amp; Stress)</Bullet>
          <Bullet>34+ instrument live scanner — forex majors + metals + oil + indices + 14+ crypto</Bullet>
          <Bullet>15-gate institutional risk system — drawdown / kill switch / cooldowns / news shield / correlation</Bullet>
          <Bullet>Multi-broker connections (MT4/MT5/cTrader/Binance/Bybit/OKX) — AES-256-GCM encrypted, trades auto-import to journal</Bullet>
          <Bullet>Performance Intelligence — Sharpe / Sortino / Calmar / drawdown clusters / per-pair edges</Bullet>
          <Bullet>Curated Telegram signal channels + tier-gated DMs</Bullet>
          <Bullet>Crypto-only billing (USDT-TRC20 + BTC/ETH/Binance Pay)</Bullet>
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          70+ engineered PRs of real, verifiable work. The codebase is auditable.
        </p>
      </Section>

      <Section title="Where we are honestly">
        <ul className="space-y-2">
          <Row label="Engineering">Production-grade. Live system; observable health.</Row>
          <Row label="Users">Early — pre-launch. The platform is days away from operator-driven launch.</Row>
          <Row label="Revenue">Crypto-payment rails live; first paid signups expected this launch window.</Row>
          <Row label="Runway">Limited. Cloud costs (Vercel, Railway, Supabase, data providers) eat into a small personal budget.</Row>
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          No invented traction. The story is: the hard engineering is done; the next 60–90 days are user acquisition + monetization with extended runway.
        </p>
      </Section>

      <Section title="What support unlocks">
        <ul className="space-y-2 text-sm">
          <li>• <span className="font-semibold text-foreground">Runway</span> to maintain the platform while it onboards paying users.</li>
          <li>• <span className="font-semibold text-foreground">Data tier upgrades</span> — multi-TF confirmation, higher provider quotas, premium feeds for full forex coverage.</li>
          <li>• <span className="font-semibold text-foreground">Audited go-live</span> of the auto-execution layer (opt-in; staged validation before any real-money fan-out).</li>
          <li>• <span className="font-semibold text-foreground">Growth surface</span> — paid Telegram-channel listings directory, referral payouts, content engine.</li>
        </ul>
      </Section>

      <Section title="Why now, why this founder">
        <p>
          The retail trading product space is loud and shallow. AlgoSphere is the
          opposite — quiet, deeply engineered, institutional by construction.
          One person shipped the full stack: data infrastructure, signal engine,
          15-gate risk layer, behavioral journal with 5 process grades, AI coach,
          Strategy Lab, consolidated market intelligence, payment rails, chart
          workspace, public APIs. That same person is asking for the runway to
          put it in users&apos; hands.
        </p>
      </Section>

      <Section title="How to support">
        <p>
          If you back early-stage technical founders or you want to be the first
          believer in something institutional-grade built without a team,{' '}
          <a href="mailto:denis5bright7889@gmail.com?subject=AlgoSphere%20Quant%20%E2%80%94%20investor%20interest"
             className="font-semibold text-amber-300 hover:underline">
            email the founder directly
          </a>.
          Cheque size doesn&apos;t matter as much as belief and reach. SAFEs,
          rolling angel funds, grants, and revenue-share are all open.
        </p>
      </Section>

      <footer className="border-t border-border/60 pt-6 text-center text-[11px] text-muted-foreground">
        AlgoSphere Quant · <Link href="/" className="hover:underline">algospherequant.com</Link> ·
        <Link href="/live" className="ml-2 hover:underline">live signals</Link>
      </footer>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
      <div className="text-sm leading-relaxed text-foreground/90 md:text-base">{children}</div>
    </section>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm">
      <span className="mr-2 text-amber-300">•</span>{children}
    </li>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border/50 bg-card/30 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="w-28 shrink-0 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </li>
  )
}
