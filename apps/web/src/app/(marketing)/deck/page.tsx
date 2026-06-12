/**
 * /deck — public, shareable pitch deck.
 *
 * One artifact, two uses:
 *  1. A DocSend-style link to send to anyone — preview card renders on
 *     X / Telegram / LinkedIn via opengraph-image.tsx.
 *  2. Print-clean: each slide page-breaks in PDF (Cmd/Ctrl-P → Save as PDF).
 *
 * Honest by construction — every claim is visibly true on the live system.
 * No fake traction, no invented metrics, no fluff. Same rule as /investors.
 */
import Link from 'next/link'
import PrintButton from './PrintButton'

export const metadata = {
  title: 'Pitch — AlgoSphere Quant',
  description:
    'A 12-slide deck on AlgoSphere Quant — the institutional Trader Performance Intelligence stack for retail traders. 19 behavioral metrics, Trading Maturity Index, AI Coach, Decision Intelligence OS, 15-gate risk, multi-broker execution. Shipped end-to-end, live, honest.',
  alternates: { canonical: '/deck' },
  openGraph: {
    type: 'website',
    title: 'AlgoSphere Quant — investor deck',
    description:
      'Institutional Trader Performance Intelligence for retail. Behavioral engine · Trading Maturity Index · Decision Intelligence OS · 15-gate risk · multi-broker execution.',
    url: '/deck',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AlgoSphere Quant — investor deck',
    description: 'Institutional Trader Performance Intelligence stack for retail — shipped end-to-end by a solo founder.',
  },
}

export const dynamic = 'force-dynamic'

// Each slide is a full-viewport section on screen (snap-scroll) and a
// single page in PDF (print:break-after-page). The print stylesheet drops
// the snap and lets the browser page each slide naturally.
const SLIDE =
  'relative flex min-h-screen snap-start flex-col justify-between gap-10 px-8 py-14 md:px-20 md:py-24 ' +
  'border-b border-border/40 print:min-h-0 print:border-0 print:break-after-page print:py-12'

export default function PitchDeckPage() {
  return (
    <>
      <main className="snap-y snap-mandatory overflow-y-scroll bg-background text-foreground print:overflow-visible">
        {/* 1 — Title */}
        <section className={SLIDE + ' justify-center'}>
          <SlideTag n={1} of={12} />
          <div className="space-y-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-300">
              Pitch deck · 2026
            </p>
            <h1 className="text-5xl font-bold tracking-tight md:text-7xl">
              AlgoSphere <span className="text-gradient">Quant</span>
            </h1>
            <p className="max-w-3xl text-xl text-muted-foreground md:text-2xl">
              The institutional Trader Performance Intelligence stack — for retail traders.
              Shipped end-to-end. Honest by construction.
            </p>
            <p className="text-sm text-muted-foreground">
              <Link href="/live" className="hover:text-amber-300">algospherequant.com/live</Link> · live engine
            </p>
          </div>
          <FooterMeta />
        </section>

        {/* 2 — Problem */}
        <section className={SLIDE}>
          <SlideHead n={2} eyebrow="Problem" title="Retail traders don&apos;t lack signals. They lack feedback." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The signals industry sells lottery tickets — opaque indicators, untracked outcomes, no behavioral feedback, no risk gates. A winning trade and a lucky one are indistinguishable. A losing trade and a disciplined one are indistinguishable.</P>
            <P>Meanwhile institutional desks score every trade as a structured decision event: behavior labelled, risk gated, edge attributed. They know exactly which traders are maturing and which are tilting.</P>
            <P className="text-amber-300">That feedback loop stays locked inside hedge funds. Until now.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 3 — Solution */}
        <section className={SLIDE}>
          <SlideHead n={3} eyebrow="Solution" title="Score every trader on 19 behavioral axes. Land them on the Maturity Index. Coach the gap." />
          <div className="grid gap-6 md:grid-cols-2">
            <Card label="The shift">
              From signal vending to <span className="text-amber-300">Trader Performance Intelligence</span>. Every trade — human-executed or engine-executed — is a structured behavioral event with required Strategy + Psychology context.
            </Card>
            <Card label="The output">
              <span className="font-semibold text-foreground">19 deterministic behavioral metrics</span> (revenge · tilt · FOMO · confidence drift · recency bias · strategy hopping · resilience · patience · rule adherence · self-control · risk discipline · …) collapse into one institutional verdict: the <span className="text-amber-300">Trading Maturity Index</span> — Beginner · Developing · Competent · Advanced · Elite. An always-on AI Coach names the top weaknesses and prescribes specific fixes. Pure math; no LLM dependency.
            </Card>
          </div>
          <FooterMeta />
        </section>

        {/* 4 — Product (live) */}
        <section className={SLIDE}>
          <SlideHead n={4} eyebrow="Product · live today" title="Verifiable on the running system." />
          <ul className="grid gap-3 md:grid-cols-2">
            {[
              ['Behavioral Engine V2', '19 deterministic metrics: revenge · overtrade · risk inflation · discipline · consistency · FOMO · weekend gambling · impulse · loss chasing · confidence drift · tilt · recency bias · strategy hopping · resilience · patience · rule adherence · self-control · risk discipline · Trading Maturity Index.'],
              ['Trading Maturity Index', 'One institutional verdict per trader: Beginner · Developing · Competent · Advanced · Elite. Weighted blend of 6 positive composites; deterministic, reproducible, auditable.'],
              ['AI Coach (deterministic)', 'Always-on narrative — ranked strengths, weaknesses, top-3 templated recommendations keyed to the worst axis. Free; no LLM dependency.'],
              ['Two-Mode Trade Journal (V4)', 'Distinct lifecycles: human-executed trades teach about the trader, engine-executed trades teach about the strategy. Mode-aware API, grading, and Deployment Readiness ladder.'],
              ['Decision Intelligence OS', '5 consolidated intelligence hubs — Capital Flows · Sentiment · Structure · Momentum · Market Pulse. Redis-cached, multi-source provider chains.'],
              ['Strategy Lab', 'Visual Quant Builder · realistic-cost Backtester · Monte Carlo with sample-size confidence · Optimization Center · 6-stage Deployment Readiness ladder.'],
              ['15-gate institutional risk', 'Two-layer: strategy gate + capital gate. Drawdown · kill switch · cooldowns · correlation cap · news shield. Overrides every signal.'],
              ['Multi-broker execution', 'Binance · Bybit · OKX · MT5 via dedicated VPS bridge. Per-user vault, AES-256 encrypted. Broker-truth reconciler enriches every closed trade.'],
              ['Media Engine V3 + content factory', '45+ asset kinds across 9 producer modules. ffmpeg + PIL pipeline emits 1080×1920 vertical reels, branded cards, infographics, carousels, blogs, PDFs.'],
              ['Multi-channel distribution', 'Telegram + Discord live. Instagram automated via Graph API. Meta + LinkedIn adapters wired. Crypto-only billing rails. Public /api/v1/decision surface.'],
            ].map(([t, d]) => <BulletCard key={t as string} title={t as string}>{d as string}</BulletCard>)}
          </ul>
          <FooterMeta note="Four-service production architecture. The codebase is auditable." />
        </section>

        {/* 5 — Architecture */}
        <section className={SLIDE}>
          <SlideHead n={5} eyebrow="How it works" title="Six layers, four deployments, observable end-to-end." />
          <div className="space-y-3 text-base md:text-lg">
            <Layer step="L1" name="Market data + broker ingest" detail="Multi-provider OHLCV chain (TwelveData · Finnhub · Alpha Vantage · CoinGecko) with provider fallback. Broker fills auto-import into the V4 two-mode journal." />
            <Layer step="L2" name="Decision Intelligence engines" detail="Regime · momentum · smart money · whale flow · structure · sentiment · volatility · rolling-Pearson correlation. Redis-cached. Each emits a normalised, sanitised score." />
            <Layer step="L3" name="Decision brain + 15-gate risk" detail="Σ(score × weight) with disagreement penalties. Two-layer risk — strategy gate + institutional capital gate (15 gates + kill switch) — overrides every signal." />
            <Layer step="L4" name="Trader Performance Intelligence" detail="19 deterministic behavioral metrics collapse into 6 positive composites and the Trading Maturity Index (Beginner → Elite). AI Coach narrative is always-on, free, reproducible." />
            <Layer step="L5" name="Strategy Lab" detail="Visual Quant Builder · realistic-cost Backtester · Monte Carlo with sample-size confidence · Optimization Center · 6-stage Deployment Readiness ladder (Research → Institutional)." />
            <Layer step="L6" name="Distribution & opt-in execution" detail="Media Engine V3 fans 45+ asset kinds out to Telegram, Discord, Instagram, Meta, LinkedIn. Public /api/v1/decision. Execution opt-in per user with their own broker." />
          </div>
          <FooterMeta note="Vercel web · Railway engine · Railway asset-worker · Windows VPS MT5 bridge · Supabase backbone." />
        </section>

        {/* 6 — Moat */}
        <section className={SLIDE}>
          <SlideHead n={6} eyebrow="Why it&apos;s hard to clone" title="The product is the verdict — not the signals." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The Behavioral Engine forces structured Strategy + Psychology context on every trade. The resulting dataset — a trader&apos;s decision behavior scored across 19 axes — is unique to AlgoSphere and compounds with every entry.</P>
            <P>Scoring is <span className="font-semibold text-amber-300">deterministic and process-based — PnL never grades</span>. A losing trade can be A-grade execution; a winning one can be a maturity downgrade. That signal is invisible to every &quot;trade copier&quot; on the market.</P>
            <P>The <span className="text-amber-300">Trading Maturity Index</span> is the institutional output prop firms, regulators and allocators already ask for. AlgoSphere is the only retail product that answers it.</P>
            <P className="text-base text-muted-foreground">The architecture itself is the operational moat: four-service deployment, Redis-cached multi-source providers, observable health, anti-reverse-engineering API, governed adaptive weighting. Clones don&apos;t ship this.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 7 — Market */}
        <section className={SLIDE}>
          <SlideHead n={7} eyebrow="Market" title="Retail + prosumer traders demanding rigour they can&apos;t find anywhere else." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The retail signals market is enormous and almost entirely unserious — opaque indicators, untracked outcomes, no behavioral feedback. The bar to be the credible alternative is low.</P>
            <P>Adjacent: prop firms (who need behavioral compliance), Telegram signal economies, public-API consumers (developers, small funds), trader education platforms.</P>
            <P className="text-muted-foreground text-base">No fabricated TAM. The market exists; the credible competitor doesn&apos;t.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 8 — Business model */}
        <section className={SLIDE}>
          <SlideHead n={8} eyebrow="Business model" title="Subscriptions sold on outcome, not feature list." />
          <div className="grid gap-4 md:grid-cols-3">
            <Card label="Subscriptions"><span className="font-semibold text-foreground">Free</span> see your Maturity Index · <span className="font-semibold text-foreground">Starter $29</span> close the top weakness · <span className="font-semibold text-foreground">Pro $99</span> Strategy Lab + Decision Intelligence + multi-broker · <span className="font-semibold text-foreground">VIP $299</span> auto-execution + API. Crypto-only (USDT-TRC20 + BTC/ETH/Binance Pay).</Card>
            <Card label="Listings directory">Paid Telegram-channel listings on a moderated public directory. Recurring revenue plus a funnel into Pro/VIP for the channel operators themselves.</Card>
            <Card label="API access">Strict <code className="text-amber-300">/api/v1/decision</code> for institutional + developer consumers (VIP scope). Anti-reverse-engineering surface; per-key rate-limits + telemetry.</Card>
          </div>
          <FooterMeta />
        </section>

        {/* 9 — Traction (honest) */}
        <section className={SLIDE}>
          <SlideHead n={9} eyebrow="Where we are honestly" title="Engineering shipped. Distribution wired. Pre-revenue." />
          <ul className="grid gap-3 md:grid-cols-2">
            <BulletCard title="Engineering">Four-service production stack live: Vercel web · Railway engine · Railway asset-worker · Windows VPS MT5 bridge · Supabase backbone. Observable health, automated retries, mirror-trigger audit trail.</BulletCard>
            <BulletCard title="Behavioral Engine V2 + AI Coach">Live: 19 deterministic metrics + Trading Maturity Index + always-on coaching narrative. Two-Mode V4 journal grading every entry.</BulletCard>
            <BulletCard title="Strategy Lab + Decision Intelligence OS">Quant Builder · Backtester · Monte Carlo · Optimization Center · Deployment Readiness ladder. 5-hub market intelligence (Capital Flows · Sentiment · Structure · Momentum · Pulse) with Redis cache + multi-source provider chains.</BulletCard>
            <BulletCard title="Content + distribution">Media Engine V3 producing 45+ asset kinds. 13,000+ items generated lifetime; 300+ published. Active distribution to Telegram + Discord; automated Instagram via Graph API (129 posts shipped); Meta + LinkedIn adapters wired.</BulletCard>
            <BulletCard title="Brokers">Paper-trading live. MT5 multi-tenant bridge operational on dedicated VPS. Binance · Bybit · OKX adapters built + encrypted-vault gated.</BulletCard>
            <BulletCard title="Monetization">Crypto rails wired (USDT-TRC20, BTC, ETH, Binance Pay). Tier definitions + admin approval flow shipped. Pre-revenue — first paid signups expected this launch window.</BulletCard>
          </ul>
          <p className="text-sm text-muted-foreground">No invented traction. What you see on the live site — and in this deck — is the full story.</p>
          <FooterMeta />
        </section>

        {/* 10 — Team */}
        <section className={SLIDE}>
          <SlideHead n={10} eyebrow="Team" title="One technical founder. Full stack, shipped." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>Built the entire platform alone — multi-provider data infrastructure, decision engines, two-layer 15-gate risk system, Behavioral Engine V2 + Trading Maturity Index, AI Coach, Two-Mode Trade Journal V4, Strategy Lab with Deployment Readiness ladder, Decision Intelligence OS, Media Engine V3 content factory, multi-broker execution (incl. dedicated MT5 VPS bridge), crypto payment rails, public APIs.</P>
            <P>The codebase is auditable. The live system is inspectable. Every claim in this deck maps to a running service.</P>
            <P className="text-muted-foreground text-base">Solo today. Capital-efficient by necessity; ready to scale with the right backing.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 11 — The ask */}
        <section className={SLIDE + ' justify-center'}>
          <SlideHead n={11} eyebrow="The ask" title="A first-believer cheque. Runway to land the verdict in users&apos; hands." />
          <ul className="grid gap-3 md:grid-cols-2">
            <BulletCard title="Multi-service runway">Operate Vercel + Railway (engine + asset-worker) + Contabo VPS + Supabase + data providers through user onboarding + paid-tier conversion. Current burn is small; the unit economics improve sharply at first revenue.</BulletCard>
            <BulletCard title="Data tier upgrades">Higher TwelveData / Finnhub / Alpha Vantage / on-chain provider quotas — full forex coverage + multi-timeframe confirmation across Decision Intelligence engines.</BulletCard>
            <BulletCard title="Audited execution go-live">Staged validation of the opt-in auto-trade layer (FULL_AUTOTRADE arming model) before any real-money fan-out. Two-layer risk + kill switch already enforce; we add an external audit pass.</BulletCard>
            <BulletCard title="Distribution acceleration">Content engine produces; algorithmic invisibility caps reach. Paid amplification + influencer partnerships convert the existing factory output into Maturity-Index sign-ups.</BulletCard>
          </ul>
          <p className="text-base text-muted-foreground">
            Cheque size matters less than belief and reach. SAFE / rolling angel / grant / revenue-share all open.
          </p>
          <FooterMeta />
        </section>

        {/* 12 — Contact */}
        <section className={SLIDE + ' justify-center'}>
          <SlideTag n={12} of={12} />
          <div className="space-y-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-300">Contact</p>
            <h2 className="text-4xl font-bold tracking-tight md:text-6xl">Let&apos;s talk.</h2>
            <ul className="space-y-3 text-lg md:text-xl">
              <li>📧 <a href="mailto:info@algospherequant.com?subject=AlgoSphere%20Quant%20%E2%80%94%20investor%20interest"
                       className="text-amber-300 hover:underline">info@algospherequant.com</a></li>
              <li>📊 <Link href="/live" className="text-amber-300 hover:underline">algospherequant.com/live</Link> — engine working in real time</li>
              <li>📄 <Link href="/investors" className="text-amber-300 hover:underline">algospherequant.com/investors</Link> — full investor brief</li>
              <li>🌐 <Link href="/" className="text-amber-300 hover:underline">algospherequant.com</Link></li>
            </ul>
          </div>
          <FooterMeta note="The honest verdict beats the polished pitch. Thank you for reading." />
        </section>
      </main>
      <PrintButton />
    </>
  )
}

// ── slide bits ───────────────────────────────────────────────────────────

function SlideTag({ n, of }: { n: number; of: number }) {
  return (
    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
      <span>AlgoSphere Quant</span>
      <span>{String(n).padStart(2, '0')} / {of}</span>
    </div>
  )
}

function SlideHead({ n, eyebrow, title }: { n: number; eyebrow: string; title: string }) {
  return (
    <div className="space-y-4">
      <SlideTag n={n} of={12} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-300">{eyebrow}</p>
      <h2 className="max-w-4xl text-3xl font-bold tracking-tight md:text-5xl">{title}</h2>
    </div>
  )
}

function P({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`max-w-3xl text-foreground/90 ${className}`}>{children}</p>
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-6">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <p className="mt-3 text-base text-foreground/90 md:text-lg">{children}</p>
    </div>
  )
}

function BulletCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-border/60 bg-card/30 p-4">
      <div className="text-sm font-bold text-foreground">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </li>
  )
}

function Layer({ step, name, detail }: { step: string; name: string; detail: string }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border/60 bg-card/30 p-4">
      <span className="shrink-0 rounded-md bg-gradient-primary px-2.5 py-1 text-xs font-bold text-black">{step}</span>
      <div>
        <div className="text-base font-semibold">{name}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function FooterMeta({ note }: { note?: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border/30 pt-4 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
      <span>{note ?? 'algospherequant.com'}</span>
      <span>Honest by construction</span>
    </div>
  )
}
