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
    'A 12-slide deck on AlgoSphere Quant — institutional market intelligence shipped end-to-end by a solo founder. Live engine, real architecture, honest traction. Open to first-believer support.',
  alternates: { canonical: '/deck' },
  openGraph: {
    type: 'website',
    title: 'AlgoSphere Quant — investor deck',
    description:
      'Institutional market intelligence shipped end-to-end by a solo founder. Live engine. Honest deck.',
    url: '/deck',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AlgoSphere Quant — investor deck',
    description: 'Institutional market intelligence shipped end-to-end by a solo founder.',
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
              Institutional market intelligence, shipped end-to-end by one founder.
            </p>
            <p className="text-sm text-muted-foreground">
              <Link href="/live" className="hover:text-amber-300">algospherequant.com/live</Link> · live engine
            </p>
          </div>
          <FooterMeta />
        </section>

        {/* 2 — Problem */}
        <section className={SLIDE}>
          <SlideHead n={2} eyebrow="Problem" title="Retail traders pay for noise. Real intelligence is locked up." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The signals industry sells lottery tickets — opaque indicators, untracked outcomes, no risk gates.</P>
            <P>Meanwhile institutional desks run consolidated intelligence: regime detection, smart-money flow, liquidity, layered risk.</P>
            <P className="text-amber-300">That stack stays behind hedge-fund and prime-broker firewalls.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 3 — Solution */}
        <section className={SLIDE}>
          <SlideHead n={3} eyebrow="Solution" title="One decision brain. Institutional read, unbundled." />
          <div className="grid gap-6 md:grid-cols-2">
            <Card label="What it consumes">
              Regime · momentum · market internals (breadth, sectors, dominance) · smart-money proxies · whale flow · volatility · correlations · execution health.
            </Card>
            <Card label="What it outputs">
              A single decision state — market state · trade bias · confidence · risk · action. No raw indicators. No exposed weights. No black box claims.
            </Card>
          </div>
          <FooterMeta />
        </section>

        {/* 4 — Product (live) */}
        <section className={SLIDE}>
          <SlideHead n={4} eyebrow="Product · live today" title="Verifiable on the running system." />
          <ul className="grid gap-3 md:grid-cols-2">
            {[
              ['30-instrument live scanner', 'Forex · gold · silver · platinum · palladium · WTI · Brent · 14 crypto.'],
              ['Weighted-ensemble engine', '8 independent strategies, regime-adaptive thresholds — no hard consensus starvation.'],
              ['Persistent OHLCV cache', 'Survives deploys; provider quota outages no longer cold-start the universe.'],
              ['Symbol health observability', 'Per-instrument ACTIVE / DEGRADED / STALE / OFFLINE — surfaced honestly, never faked.'],
              ['Institutional risk gate', 'Drawdown · circuit breaker · sizing. Overrides the strategy layer.'],
              ['Decision Brain', 'Consolidates every engine into one strict output. Anti-copy by design.'],
              ['TradingView-grade chart workspace', 'Multi-chart, symbol registry, AI rail.'],
              ['Telegram auto-broadcaster', 'Channel posts + tier-gated DMs. Dedup · retry · flood-control.'],
              ['Crypto payment rails', 'Binance Pay / TRC20 with admin approval.'],
              ['Public API', '/api/v1/decision — strict anti-reverse-engineering surface.'],
            ].map(([t, d]) => <BulletCard key={t as string} title={t as string}>{d as string}</BulletCard>)}
          </ul>
          <FooterMeta note="50+ engineered PRs. The codebase is auditable." />
        </section>

        {/* 5 — Architecture */}
        <section className={SLIDE}>
          <SlideHead n={5} eyebrow="How it works" title="Layered, governed, honest by construction." />
          <div className="space-y-3 text-base md:text-lg">
            <Layer step="L1" name="Market data" detail="Multi-provider chain (Coinbase · Twelve Data · Polygon · Alpha Vantage), persistent OHLCV cache." />
            <Layer step="L2" name="Intelligence engines" detail="Regime · momentum · smart money · whale flow · breadth · sectors · volatility · correlations. Each emits a normalised score." />
            <Layer step="L3" name="Adaptive weighting" detail="Regime-aware weighting (deterministic, in production). Governed offline learning — never silent auto-mutation." />
            <Layer step="L4" name="Decision brain" detail="Σ(score × weight). Disagreement penalties. Strict output: market state · bias · confidence · risk · action." />
            <Layer step="L5" name="Delivery & execution" detail="Web feed · public API · Telegram broadcaster. Execution is opt-in per user with their own broker." />
          </div>
          <FooterMeta />
        </section>

        {/* 6 — Moat */}
        <section className={SLIDE}>
          <SlideHead n={6} eyebrow="Why it's hard to clone" title="The product is intelligence abstraction — not signals." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>States, probability and confidence are exposed; raw formulas, weights and wallet logic never are.</P>
            <P>Adaptive weighting is <span className="font-semibold text-amber-300">governed</span> — proposals, audit trails, human activation. No black-box drift in production.</P>
            <P>The architecture itself is the moat: layered separation, observable health, anti-reverse-engineering API.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 7 — Market */}
        <section className={SLIDE}>
          <SlideHead n={7} eyebrow="Market" title="Retail + prosumer traders demanding institutional rigour." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The retail signals market is enormous and almost entirely unserious — the bar to be the credible institutional-grade option is low.</P>
            <P>Adjacent: prop firms, copy-trading networks, Telegram signal economies, public-API consumers (developers, allocators, small funds).</P>
            <P className="text-muted-foreground text-base">No fabricated TAM. The market exists; the credible competitor doesn&apos;t.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 8 — Business model */}
        <section className={SLIDE}>
          <SlideHead n={8} eyebrow="Business model" title="Subscription, listings marketplace, API access." />
          <div className="grid gap-4 md:grid-cols-3">
            <Card label="Subscriptions">Free trial · Starter · Premium · VIP tiers. Crypto rails live (Binance / TRC20).</Card>
            <Card label="Listings marketplace">Paid Telegram-channel listings on a moderated public directory. Founder tool + revenue.</Card>
            <Card label="API access">Strict <code className="text-amber-300">/api/v1/decision</code> for institutional + developer consumers (VIP scope).</Card>
          </div>
          <FooterMeta />
        </section>

        {/* 9 — Traction (honest) */}
        <section className={SLIDE}>
          <SlideHead n={9} eyebrow="Where we are honestly" title="Engineering complete. Pre-launch users. Days from operator-driven launch." />
          <ul className="grid gap-3 md:grid-cols-2">
            <BulletCard title="Engineering">Production-grade. Live system. Observable health.</BulletCard>
            <BulletCard title="Data infrastructure">Just upgraded — 30 instruments live and feeding the engine at full coverage.</BulletCard>
            <BulletCard title="Users">Pre-launch. Public funnels (live feed + share cards + OG previews) shipped.</BulletCard>
            <BulletCard title="Revenue">Crypto rails live; first paid signups expected this launch window.</BulletCard>
          </ul>
          <p className="text-sm text-muted-foreground">No invented traction. What you see on the live site is the full story.</p>
          <FooterMeta />
        </section>

        {/* 10 — Team */}
        <section className={SLIDE}>
          <SlideHead n={10} eyebrow="Team" title="One technical founder. Full stack, shipped." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>Built the entire platform alone — data infrastructure, signal engine, risk layer, decision brain, intelligence surfaces, payment rails, chart workspace, public APIs, governance docs.</P>
            <P>50+ PRs of verifiable engineering. Live system you can inspect right now.</P>
            <P className="text-muted-foreground text-base">Solo today. Capital-efficient by necessity; ready to scale with the right backing.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 11 — The ask */}
        <section className={SLIDE + ' justify-center'}>
          <SlideHead n={11} eyebrow="The ask" title="A first-believer cheque. Runway to put it in users' hands." />
          <ul className="grid gap-3 md:grid-cols-2">
            <BulletCard title="Runway">Maintain the platform through user onboarding + paid-tier conversion.</BulletCard>
            <BulletCard title="Data tier upgrades">Multi-timeframe confirmation, higher provider quotas, premium feeds.</BulletCard>
            <BulletCard title="Audited execution go-live">Staged validation of the opt-in auto-trade layer before real-money fan-out.</BulletCard>
            <BulletCard title="Growth surface">Listings marketplace, referral payouts, content engine.</BulletCard>
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
              <li>📧 <a href="mailto:denis5bright7889@gmail.com?subject=AlgoSphere%20Quant%20%E2%80%94%20investor%20interest"
                       className="text-amber-300 hover:underline">denis5bright7889@gmail.com</a></li>
              <li>📊 <Link href="/live" className="text-amber-300 hover:underline">algospherequant.com/live</Link> — engine working in real time</li>
              <li>📄 <Link href="/investors" className="text-amber-300 hover:underline">algospherequant.com/investors</Link> — full investor brief</li>
              <li>🌐 <Link href="/" className="text-amber-300 hover:underline">algospherequant.com</Link></li>
            </ul>
          </div>
          <FooterMeta note="The honest version beats the polished one. Thank you for reading." />
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
