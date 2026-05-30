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
    'A 12-slide deck on AlgoSphere Quant — an AI Trader Intelligence Operating System shipped end-to-end by a solo founder. Behavioral journal, AI Coach, Strategy Lab, 15-gate risk. Live, working, honest.',
  alternates: { canonical: '/deck' },
  openGraph: {
    type: 'website',
    title: 'AlgoSphere Quant — investor deck',
    description:
      'AI Trader Intelligence OS shipped end-to-end by a solo founder. Behavioral journal · AI Coach · Strategy Lab · 15-gate risk.',
    url: '/deck',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AlgoSphere Quant — investor deck',
    description: 'AI Trader Intelligence OS shipped end-to-end by a solo founder.',
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
              The AI Trader Intelligence Operating System, shipped end-to-end by one founder.
            </p>
            <p className="text-sm text-muted-foreground">
              <Link href="/live" className="hover:text-amber-300">algospherequant.com/live</Link> · live engine
            </p>
          </div>
          <FooterMeta />
        </section>

        {/* 2 — Problem */}
        <section className={SLIDE}>
          <SlideHead n={2} eyebrow="Problem" title="Retail traders pay for noise. They never learn." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The signals industry sells lottery tickets — opaque indicators, untracked outcomes, no behavioral feedback, no risk gates.</P>
            <P>Meanwhile institutional desks treat every trade as a structured decision event: process logged, outcome attributed, behavior corrected over time.</P>
            <P className="text-amber-300">That feedback loop stays locked inside hedge funds.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 3 — Solution */}
        <section className={SLIDE}>
          <SlideHead n={3} eyebrow="Solution" title="Teach the trader. Score the trade. Build the next edge." />
          <div className="grid gap-6 md:grid-cols-2">
            <Card label="The shift">
              From signal vending to Trader Intelligence. Every trade — manually logged or auto-imported from a broker — is a structured intelligence event.
            </Card>
            <Card label="The output">
              5 process grades per trade (Execution · Psychology · Risk · Discipline · Timing) plus 3+ AI insights. An AI Coach with pair-specific recommendations. A Strategy Lab to validate the next edge.
            </Card>
          </div>
          <FooterMeta />
        </section>

        {/* 4 — Product (live) */}
        <section className={SLIDE}>
          <SlideHead n={4} eyebrow="Product · live today" title="Verifiable on the running system." />
          <ul className="grid gap-3 md:grid-cols-2">
            {[
              ['Behavioral Trade Journal', '5 process grades + 3+ AI insights per trade. Required Strategy + Psychology context.'],
              ['AI Coach', 'Streak-aware, pair-specific recommendations. Never PnL-driven verdicts.'],
              ['Strategy Lab', 'Visual Quant Builder · realistic-cost Backtester · Monte Carlo with sample-size confidence · Optimization Center · Deployment Readiness ladder.'],
              ['34+ instrument live scanner', 'Forex majors · metals · oil · indices · 14+ crypto.'],
              ['Consolidated Market Intelligence', '6 sections — regime · liquidity & flows · sentiment · rotation · momentum · volatility & stress.'],
              ['15-gate institutional risk system', 'Drawdown · kill switch · cooldowns · correlation cap · news shield. Overrides strategy.'],
              ['Multi-broker connections', 'MT4/MT5/cTrader/Binance/Bybit/OKX. AES-256-GCM encrypted. Trades auto-import to the journal.'],
              ['Telegram signal channels', 'Curated directory + tier-gated DMs. Dedup · retry · flood-control.'],
              ['Crypto payment rails', 'USDT-TRC20 + BTC/ETH/Binance Pay with admin approval.'],
              ['Public API', '/api/v1/decision — strict anti-reverse-engineering surface.'],
            ].map(([t, d]) => <BulletCard key={t as string} title={t as string}>{d as string}</BulletCard>)}
          </ul>
          <FooterMeta note="70+ engineered PRs. The codebase is auditable." />
        </section>

        {/* 5 — Architecture */}
        <section className={SLIDE}>
          <SlideHead n={5} eyebrow="How it works" title="Layered, governed, honest by construction." />
          <div className="space-y-3 text-base md:text-lg">
            <Layer step="L1" name="Market data + broker ingest" detail="Multi-provider OHLCV chain · broker-fill auto-import to the journal (V4 two-mode source distinction)." />
            <Layer step="L2" name="Intelligence engines" detail="Regime · momentum · smart money · whale flow · breadth · sectors · volatility · correlations. Each emits a normalised score." />
            <Layer step="L3" name="Decision brain + 15-gate risk" detail="Σ(score × weight) with disagreement penalties. Risk gates enforced before any signal publishes." />
            <Layer step="L4" name="Behavioral grading + AI Coach" detail="Every journaled trade scored on 5 process axes. Coach reads streaks + pair edges + emotion context to emit specific fixes." />
            <Layer step="L5" name="Strategy Lab" detail="Visual Quant Builder · Backtester with realistic costs · Monte Carlo · Optimization Center · Deployment Readiness ladder (Research → Institutional)." />
            <Layer step="L6" name="Delivery & opt-in execution" detail="Web feed · public API · Telegram. Execution is opt-in per user with their own broker." />
          </div>
          <FooterMeta />
        </section>

        {/* 6 — Moat */}
        <section className={SLIDE}>
          <SlideHead n={6} eyebrow="Why it's hard to clone" title="The product is behavioral feedback — not signals." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>The Behavioral Journal forces structured Strategy + Psychology context on every trade — the resulting dataset (a trader&apos;s actual decision behavior, scored) is unique to AlgoSphere.</P>
            <P>The grading engine is <span className="font-semibold text-amber-300">process-based, never PnL-based</span> — a losing trade can be A-grade execution. That signal is invisible to every &quot;trade copier&quot; on the market.</P>
            <P>The architecture itself is the moat: layered separation, observable health, anti-reverse-engineering API, governed adaptive weighting.</P>
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
          <SlideHead n={8} eyebrow="Business model" title="Subscriptions, listings directory, API access." />
          <div className="grid gap-4 md:grid-cols-3">
            <Card label="Subscriptions">Free · Starter $29 · Pro $99 · VIP $299. Each tier promises a different outcome — understand · build · deploy the edge. Crypto-only billing (USDT-TRC20 + BTC/ETH/Binance Pay).</Card>
            <Card label="Listings directory">Paid Telegram-channel listings on a moderated public directory. Founder tool + revenue.</Card>
            <Card label="API access">Strict <code className="text-amber-300">/api/v1/decision</code> for institutional + developer consumers (VIP scope).</Card>
          </div>
          <FooterMeta />
        </section>

        {/* 9 — Traction (honest) */}
        <section className={SLIDE}>
          <SlideHead n={9} eyebrow="Where we are honestly" title="Engineering complete. Pre-launch. Days from operator-driven launch." />
          <ul className="grid gap-3 md:grid-cols-2">
            <BulletCard title="Engineering">Production-grade. Live system. Observable health. 70+ PRs of verifiable work.</BulletCard>
            <BulletCard title="Behavioral journal (V4)">Live: required Strategy + Psychology context, 5 process grades + 3+ insights per trade.</BulletCard>
            <BulletCard title="Strategy Lab + audit fixes">Quant Builder · Backtester (audited grader, fixed drawdown formatter, MC sample-size gating) · Optimization Center · Deployment Readiness ladder.</BulletCard>
            <BulletCard title="Users">Pre-launch. Public funnels (live feed + investor brief + share cards) shipped.</BulletCard>
          </ul>
          <p className="text-sm text-muted-foreground">No invented traction. What you see on the live site is the full story.</p>
          <FooterMeta />
        </section>

        {/* 10 — Team */}
        <section className={SLIDE}>
          <SlideHead n={10} eyebrow="Team" title="One technical founder. Full stack, shipped." />
          <div className="space-y-5 text-lg md:text-xl">
            <P>Built the entire platform alone — data infrastructure, signal engine, 15-gate risk layer, behavioral journal with 5 process grades, AI coach, Strategy Lab with the Deployment Readiness ladder, consolidated market intelligence, payment rails, chart workspace, public APIs.</P>
            <P>70+ PRs of verifiable engineering. Live system you can inspect right now.</P>
            <P className="text-muted-foreground text-base">Solo today. Capital-efficient by necessity; ready to scale with the right backing.</P>
          </div>
          <FooterMeta />
        </section>

        {/* 11 — The ask */}
        <section className={SLIDE + ' justify-center'}>
          <SlideHead n={11} eyebrow="The ask" title="A first-believer cheque. Runway to put it in users' hands." />
          <ul className="grid gap-3 md:grid-cols-2">
            <BulletCard title="Runway">Maintain the platform through user onboarding + paid-tier conversion.</BulletCard>
            <BulletCard title="Data tier upgrades">Higher TwelveData / Polygon / Alpha Vantage quotas — full forex coverage + multi-timeframe confirmation.</BulletCard>
            <BulletCard title="Audited execution go-live">Staged validation of the opt-in auto-trade layer before real-money fan-out.</BulletCard>
            <BulletCard title="Growth surface">Telegram listings directory, referral payouts, content engine.</BulletCard>
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
