import type { ReactNode } from 'react'
import Logo from '@/components/brand/Logo'

export const metadata = {
  title: 'Terms of Service — AlgoSphere Quant',
  description:
    'The terms governing your use of AlgoSphere Quant — accounts, subscriptions, acceptable use, disclaimers, and trading risk.',
}

const LAST_UPDATED = 'June 1, 2026'
const LEGAL_EMAIL = 'legal@algospherequant.com'
const SUPPORT_EMAIL = 'support@algospherequant.com'

export default function TermsPage() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Logo size="sm" alt="" priority />
            <span><span className="text-gradient">AlgoSphere</span> Quant</span>
          </a>
          <a href="/login" className="text-xs text-muted-foreground hover:text-foreground">
            Sign in
          </a>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Terms of <span className="text-gradient">Service</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-foreground/85">
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of
            AlgoSphere Quant (&ldquo;AlgoSphere,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo;
            or &ldquo;our&rdquo;), including our website, dashboard, Telegram bot,
            APIs, and any related services (collectively, the &ldquo;Service&rdquo;). By
            creating an account or otherwise using the Service, you agree to these Terms.
            If you do not agree, do not use the Service.
          </p>
        </header>

        <Section title="1. The Service">
          <P>
            AlgoSphere Quant is an AI-powered trader intelligence platform. The Service
            provides analytics, behavioral and risk coaching, market intelligence,
            journaling tools, optional broker connectivity for execution and account
            syncing, and related features. The Service is designed for educational and
            informational purposes — see Section&nbsp;8.
          </P>
        </Section>

        <Section title="2. Eligibility & accounts">
          <P>
            You must be at least 18 years old and legally capable of entering into a
            binding contract in your jurisdiction. By creating an account you represent
            that the information you provide is accurate, that your use of the Service
            does not violate any law applicable to you, and that you are not located in,
            or a resident of, any jurisdiction in which use of the Service would be
            unlawful.
          </P>
          <P>
            You are responsible for safeguarding your account credentials, API keys, and
            any broker-connection secrets you supply. Notify us immediately of any
            unauthorized access. We are not liable for losses caused by your failure to
            protect your credentials.
          </P>
        </Section>

        <Section title="3. Subscriptions, billing & refunds">
          <P>
            Some features of the Service are available only to paying subscribers.
            Subscription tiers, included features, and prices are described on our
            <a href="/upgrade" className="text-amber-300 hover:underline"> pricing page</a>{' '}
            and may change from time to time. Material price changes take effect at your
            next renewal and will be communicated in advance.
          </P>
          <SubTitle>Payment methods</SubTitle>
          <P>
            We accept cryptocurrency payments through our configured payment processors.
            Crypto transactions are final once confirmed on-chain and cannot be reversed
            by us. You are responsible for ensuring you send the correct amount, on the
            correct network, to the correct address shown in checkout.
          </P>
          <SubTitle>Trial periods</SubTitle>
          <P>
            If we offer a free trial, the trial automatically ends after the stated
            period unless you actively upgrade. We do not auto-charge crypto subscriptions
            — you re-subscribe each cycle.
          </P>
          <SubTitle>Refunds</SubTitle>
          <P>
            Because crypto payments are final, subscription fees are non-refundable except
            where required by applicable law, or in cases of duplicate accidental payment
            (provable on-chain, requested within 14 days). Contact{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-amber-300 hover:underline">
              {SUPPORT_EMAIL}
            </a>{' '}
            to request a refund review.
          </P>
        </Section>

        <Section title="4. Acceptable use">
          <P>
            You agree not to, and not to allow others to:
          </P>
          <List items={[
            'Use the Service for any illegal purpose, including circumventing sanctions, laundering funds, or evading taxes.',
            'Reverse-engineer, scrape at unreasonable rates, or attempt to extract source code, model weights, prompts, or proprietary internals.',
            'Resell, white-label, sublicense, or rebrand the Service without a written agreement with us.',
            'Share account credentials, abuse referral programs, or operate multiple accounts to evade limits.',
            'Upload content that infringes third-party rights, contains malware, or violates trading-platform terms (e.g., shared private broker API keys with revoked authorization).',
            'Attempt to interfere with the Service\'s integrity — flooding APIs, probing for vulnerabilities without prior written authorization, or disrupting other users.',
            'Use the Service to provide personalized investment advice to third parties in any jurisdiction where doing so requires a license you do not hold.',
          ]} />
        </Section>

        <Section title="5. Your content">
          <P>
            You retain ownership of the trade history, journal entries, screenshots,
            notes, and other content you submit to the Service (&ldquo;Your Content&rdquo;).
            You grant AlgoSphere a non-exclusive, worldwide, royalty-free license to
            host, process, display, and analyze Your Content solely to operate and
            improve the Service for you.
          </P>
          <P>
            We may produce aggregated, de-identified statistics derived from Your
            Content (for example, anonymized strategy-performance benchmarks). Such
            aggregations do not identify you and are not Your Content.
          </P>
        </Section>

        <Section title="6. Broker connections & third-party services">
          <P>
            If you connect a broker account (e.g., MT5, Binance, Bybit, OKX, or others),
            you authorize AlgoSphere to access your account using the credentials you
            provide, strictly for the features you enable (read-only sync, trade
            execution, or both). You can revoke this access at any time from your
            settings.
          </P>
          <P>
            The Service integrates third-party data providers, payment processors,
            chart libraries, and broker APIs. We are not responsible for those services
            — their availability, accuracy, or terms are governed by their own
            agreements with you and us.
          </P>
        </Section>

        <Section title="7. Intellectual property">
          <P>
            All rights, title, and interest in and to the Service (including software,
            models, designs, prompts, content, and trademarks), other than Your Content,
            are and remain the property of AlgoSphere or its licensors. Nothing in these
            Terms transfers any of those rights to you. You may use the Service only as
            permitted by these Terms.
          </P>
        </Section>

        <Section title="8. No financial, investment, or tax advice">
          <P>
            <strong className="text-foreground">
              AlgoSphere is not a broker-dealer, investment adviser, financial planner,
              accountant, tax adviser, or legal adviser.
            </strong>{' '}
            Signals, scores, analytics, market intelligence, AI coaching, and any other
            output of the Service are for educational and informational purposes only,
            and do not constitute personalized investment, financial, accounting, legal,
            or tax advice.
          </P>
          <P>
            You are solely responsible for your own trading decisions. Past performance
            of any strategy, signal, instrument, or backtest is not indicative of future
            results. The output of automated systems can be wrong. You should consult a
            licensed professional before acting on any information provided by the
            Service.
          </P>
        </Section>

        <Section title="9. Trading risks">
          <P>
            Trading financial instruments — including but not limited to spot crypto,
            margin, futures, contracts for difference (CFDs), forex, equities, indices,
            and commodities — carries a high level of risk and may not be suitable for
            all investors. Leverage can work for you as well as against you. You can
            lose more than your initial investment.
          </P>
          <P>
            By using execution features that connect to a broker, you accept that:
          </P>
          <List items={[
            'Orders routed through the Service depend on broker availability, market liquidity, latency, slippage, and the broker\'s own risk controls — any of which can produce outcomes materially different from those modeled or predicted.',
            'Automated and semi-automated strategies can behave unexpectedly during gaps, news events, illiquidity, exchange outages, or AlgoSphere-side incidents.',
            'You are responsible for monitoring your positions and risk independently of the Service.',
          ]} />
        </Section>

        <Section title="10. Disclaimers & warranties">
          <P>
            The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo; basis. To the maximum extent permitted by law, we disclaim
            all warranties of any kind, whether express, implied, statutory, or
            otherwise, including warranties of merchantability, fitness for a particular
            purpose, non-infringement, and uninterrupted or error-free operation.
          </P>
          <P>
            We do not warrant that any signal, score, or piece of intelligence is
            accurate, complete, profitable, or fit for any particular trading purpose,
            or that any third-party data integrated into the Service is timely or
            correct.
          </P>
        </Section>

        <Section title="11. Limitation of liability">
          <P>
            To the maximum extent permitted by law, in no event will AlgoSphere, its
            affiliates, officers, employees, agents, or licensors be liable for any
            indirect, incidental, special, consequential, exemplary, or punitive
            damages, or for any loss of profits, revenue, data, business, trading
            opportunities, or goodwill, arising out of or related to your use of, or
            inability to use, the Service — whether based on warranty, contract, tort
            (including negligence), or any other legal theory, and whether or not we
            have been advised of the possibility of such damages.
          </P>
          <P>
            To the maximum extent permitted by law, our aggregate liability for any
            claim arising out of or relating to these Terms or the Service will not
            exceed the greater of (a) the amount you paid us for the Service in the
            twelve (12) months preceding the event giving rise to the claim, or
            (b)&nbsp;US$100.
          </P>
        </Section>

        <Section title="12. Indemnification">
          <P>
            You agree to defend, indemnify, and hold harmless AlgoSphere and its
            affiliates from and against any claims, damages, liabilities, costs, and
            expenses (including reasonable attorneys&rsquo; fees) arising out of or
            related to (a)&nbsp;your use of the Service, (b)&nbsp;your violation of
            these Terms, (c)&nbsp;your violation of any law or third-party right, or
            (d)&nbsp;trading losses or actions you take based on information or features
            of the Service.
          </P>
        </Section>

        <Section title="13. Suspension & termination">
          <P>
            We may suspend or terminate your access to all or part of the Service at any
            time, with or without notice, for any reason, including suspected breach of
            these Terms, fraudulent activity, abuse of features, non-payment, or
            requirements imposed by law or third-party providers. You may close your
            account at any time from your settings.
          </P>
          <P>
            Sections that by their nature should survive termination — including
            Sections&nbsp;5&nbsp;(license to Your Content for aggregations), 7, 8, 9,
            10, 11, 12, and 16 — will survive.
          </P>
        </Section>

        <Section title="14. Changes to these Terms">
          <P>
            We may update these Terms as the Service evolves. Material changes will be
            posted here with a new &ldquo;Last updated&rdquo; date, and where
            appropriate we will notify you by email or in-app. Continued use of the
            Service after changes take effect means you accept the revised Terms. If
            you do not agree, stop using the Service.
          </P>
        </Section>

        <Section title="15. Data, privacy & your rights">
          <P>
            How we collect, use, and protect your personal data is described in our{' '}
            <a href="/privacy" className="text-amber-300 hover:underline">Privacy Policy</a>.
            You can also request deletion of your account and personal data at any time
            through our{' '}
            <a href="/data-deletion" className="text-amber-300 hover:underline">
              Data Deletion
            </a>{' '}
            process.
          </P>
        </Section>

        <Section title="16. Governing law & disputes">
          <P>
            These Terms are governed by the laws of the jurisdiction in which AlgoSphere
            is incorporated, without regard to its conflict-of-laws principles. To the
            extent permitted by law, any dispute arising out of or relating to these
            Terms or the Service will be resolved on an individual basis through binding
            arbitration in that jurisdiction. You and AlgoSphere each waive any right to
            participate in a class action.
          </P>
          <P>
            Nothing in these Terms limits any non-waivable consumer rights you may have
            under the mandatory law of your country of residence.
          </P>
        </Section>

        <Section title="17. Contact">
          <P>
            Questions about these Terms:
          </P>
          <P>
            <a href={`mailto:${LEGAL_EMAIL}`} className="text-amber-300 hover:underline">
              {LEGAL_EMAIL}
            </a>
          </P>
        </Section>
      </article>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} AlgoSphere Quant. Trading involves risk — signals are educational, not financial advice.</p>
        <div className="mt-2 flex justify-center gap-4">
          <a href="/" className="hover:underline">Home</a>
          <a href="/terms" className="hover:underline">Terms</a>
          <a href="/privacy" className="hover:underline">Privacy</a>
          <a href="/data-deletion" className="hover:underline">Data Deletion</a>
        </div>
      </footer>
    </main>
  )
}


function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function SubTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-amber-300/90">
      {children}
    </h3>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground/85">{children}</p>
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/85">
          <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-amber-400/70" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
