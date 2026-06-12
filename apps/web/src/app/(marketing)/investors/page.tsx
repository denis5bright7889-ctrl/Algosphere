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
import { INVESTORS_EMAIL } from '@/lib/brand'

export const metadata = {
  title: 'Investors & Supporters — AlgoSphere Quant',
  description:
    'AlgoSphere Quant is the institutional Trader Performance Intelligence stack for retail traders. 19 behavioral metrics + Trading Maturity Index + AI Coach + Decision Intelligence OS + 15-gate risk + multi-broker execution. Shipped end-to-end by a solo founder. Open to supporters and angel investors.',
  alternates: { canonical: '/investors' },
  openGraph: {
    type: 'website',
    title: 'AlgoSphere Quant — for investors & supporters',
    description:
      'Institutional Trader Performance Intelligence for retail. 19 behavioral metrics, Trading Maturity Index, AI Coach, Decision Intelligence OS, 15-gate risk, multi-broker execution. Shipped end-to-end.',
    url: '/investors',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AlgoSphere Quant — for investors & supporters',
    description: 'Institutional Trader Performance Intelligence stack for retail — shipped end-to-end by a solo founder.',
  },
}

export const dynamic = 'force-dynamic'

export default function InvestorsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 md:py-16">
      <header className="space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">For investors &amp; supporters</p>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          The institutional Trader Performance Intelligence stack — <span className="text-gradient">for retail traders</span>.
        </h1>
        <p className="text-base text-muted-foreground md:text-lg">
          AlgoSphere Quant scores every trade across 19 deterministic behavioral
          metrics and lands the trader on a single institutional verdict — the
          Trading Maturity Index (Beginner → Elite). An always-on AI Coach names
          the top weaknesses and prescribes specific fixes. A Decision Intelligence
          OS reads the market across five consolidated hubs. A 15-gate institutional
          risk system overrides every signal. Multi-broker execution (Binance,
          Bybit, OKX, MT5) is opt-in. Live, working, inspectable. Built by a solo
          founder. Open to supporters who back early product over polished decks.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/live"
                className="rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-bold text-black shadow-glow-gold">
            See the engine live →
          </Link>
          <a href="mailto:info@algospherequant.com?subject=AlgoSphere%20Quant%20%E2%80%94%20investor%20interest"
             className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:border-amber-500/40">
            Talk to the founder
          </a>
        </div>
      </header>

      <Section title="The problem">
        <p>
          Retail traders don&apos;t lack signals — they lack feedback. The signals
          industry sells lottery tickets: opaque indicators, untracked outcomes,
          no behavioral feedback, no risk gates. A winning trade and a lucky one
          are indistinguishable; a losing trade and a disciplined one are
          indistinguishable. Meanwhile institutional desks score every trade as a
          structured decision event — behavior labelled, risk gated, edge
          attributed. That feedback loop stays locked inside hedge funds.
        </p>
      </Section>

      <Section title="The product">
        <p>
          AlgoSphere Quant is the institutional <span className="text-amber-300">Trader Performance Intelligence</span> stack
          for retail traders. Every trade — human-executed or engine-executed — is
          a structured behavioral event with required Strategy + Psychology
          context. 19 deterministic metrics (revenge, tilt, FOMO, confidence
          drift, recency bias, strategy hopping, resilience, patience, rule
          adherence, self-control, risk discipline, …) collapse into one
          institutional verdict: the <span className="text-amber-300">Trading Maturity Index</span> — Beginner ·
          Developing · Competent · Advanced · Elite. An always-on AI Coach names
          the top weaknesses and prescribes specific fixes. Pure math; no LLM
          dependency. Signals exist but are a feature, not the lead.
        </p>
      </Section>

      <Section title="What's actually built (verifiable on the live site)">
        <ul className="grid gap-3 sm:grid-cols-2">
          <Bullet>Behavioral Engine V2 — 19 deterministic metrics including confidence drift, tilt, recency bias, strategy hopping, resilience, patience, rule adherence, self-control, risk discipline, and the Trading Maturity Index</Bullet>
          <Bullet>AI Coach (deterministic narrative) — ranked strengths, weaknesses, top-3 templated recommendations keyed to the worst axis. Free, always-on, reproducible.</Bullet>
          <Bullet>Two-Mode Trade Journal (V4) — distinct lifecycles for human-executed (teaches about the trader) vs engine-executed (teaches about the strategy)</Bullet>
          <Bullet>Decision Intelligence OS — 5 consolidated hubs (Capital Flows · Sentiment · Structure · Momentum · Market Pulse). Redis-cached; multi-source provider chains.</Bullet>
          <Bullet>Strategy Lab — visual Quant Builder · realistic-cost Backtester · Monte Carlo with sample-size confidence · Optimization Center · 6-stage Deployment Readiness ladder</Bullet>
          <Bullet>15-gate institutional risk — two-layer (strategy + capital), drawdown / kill switch / cooldowns / correlation / news shield. Overrides every signal.</Bullet>
          <Bullet>Multi-broker execution — Binance · Bybit · OKX · MT5 via dedicated VPS bridge. AES-256 encrypted per-user vault; broker-truth reconciler enriches every closed trade.</Bullet>
          <Bullet>Media Engine V3 + content factory — 45+ asset kinds across 9 producer modules. ffmpeg + PIL pipeline emits 1080×1920 vertical reels, branded cards, infographics, carousels, blogs, PDFs.</Bullet>
          <Bullet>Multi-channel distribution — Telegram + Discord live; Instagram automated via Graph API; Meta + LinkedIn adapters wired; public /api/v1/decision surface</Bullet>
          <Bullet>Crypto-only billing — USDT-TRC20 + BTC/ETH + Binance Pay with admin approval</Bullet>
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Four-service production architecture (Vercel web · Railway engine · Railway asset-worker · Windows VPS MT5 bridge · Supabase). The codebase is auditable.
        </p>
      </Section>

      <Section title="Where we are honestly">
        <ul className="space-y-2">
          <Row label="Engineering">Four-service production stack live: Vercel web · Railway engine · Railway asset-worker · Windows VPS MT5 bridge · Supabase. Observable health, automated retries, mirror-trigger audit trail.</Row>
          <Row label="Content">Media Engine V3 producing 45+ asset kinds. 13,000+ items generated lifetime; 300+ published. Distribution live to Telegram + Discord + Instagram.</Row>
          <Row label="Brokers">Paper-trading live. MT5 multi-tenant bridge operational on dedicated VPS. Binance · Bybit · OKX adapters built + encrypted-vault gated.</Row>
          <Row label="Users">Pre-launch. Public funnels (live feed + investor brief + share cards) shipped; Maturity-Index onboarding ready.</Row>
          <Row label="Revenue">Crypto rails wired; tier definitions + admin approval flow shipped. Pre-revenue — first paid signups expected this launch window.</Row>
          <Row label="Runway">Limited. Cloud costs (Vercel, Railway×2, Contabo VPS, Supabase, data providers) eat into a small personal budget.</Row>
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          No invented traction. The story is: hard engineering is done, distribution is wired, content is shipping daily; the next 60–90 days are user acquisition + monetization with extended runway.
        </p>
      </Section>

      <Section title="What support unlocks">
        <ul className="space-y-2 text-sm">
          <li>• <span className="font-semibold text-foreground">Multi-service runway</span> — operate Vercel + Railway×2 + Contabo VPS + Supabase + data providers through user onboarding and paid-tier conversion. Unit economics improve sharply at first revenue.</li>
          <li>• <span className="font-semibold text-foreground">Data tier upgrades</span> — full forex + multi-TF confirmation across the Decision Intelligence engines; higher TwelveData / Finnhub / Alpha Vantage / on-chain quotas.</li>
          <li>• <span className="font-semibold text-foreground">Audited execution go-live</span> — staged validation of the opt-in FULL_AUTOTRADE arming model before any real-money fan-out. Two-layer risk + kill switch already enforce; we add an external audit pass.</li>
          <li>• <span className="font-semibold text-foreground">Distribution acceleration</span> — content engine produces, but algorithmic invisibility caps reach. Paid amplification + influencer partnerships convert the existing factory output into Maturity-Index sign-ups.</li>
        </ul>
      </Section>

      <Section title="Why now, why this founder">
        <p>
          The retail trading product space is loud and shallow. AlgoSphere is the
          opposite — quiet, deeply engineered, institutional by construction. One
          person shipped the full stack: multi-provider data, decision engines,
          two-layer 15-gate risk, Behavioral Engine V2, Trading Maturity Index, AI
          Coach, Two-Mode V4 Journal, Strategy Lab with Deployment Readiness
          ladder, Decision Intelligence OS, Media Engine V3 content factory,
          multi-broker execution (incl. dedicated MT5 VPS bridge), crypto payment
          rails, public APIs. That same person is asking for the runway to put it
          in users&apos; hands.
        </p>
      </Section>

      <Section title="How to support">
        <p>
          If you back early-stage technical founders or you want to be the first
          believer in something institutional-grade built without a team,{' '}
          <a href="mailto:info@algospherequant.com?subject=AlgoSphere%20Quant%20%E2%80%94%20investor%20interest"
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
