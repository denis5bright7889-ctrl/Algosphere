import type { ReactNode } from 'react'
import Logo from '@/components/brand/Logo'
import { PRIVACY_EMAIL } from '@/lib/brand'

export const metadata = {
  title: 'Privacy Policy — AlgoSphere Quant',
  description:
    'How AlgoSphere Quant collects, uses, secures, and shares your personal data — and the rights you have over it.',
}

// Single source of truth for the "last updated" stamp shown in the header
// and the intro. Update this whenever the policy changes materially.
const LAST_UPDATED = 'June 1, 2026'
const CONTACT_EMAIL = PRIVACY_EMAIL

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      {/* Header — mirrors the other marketing surfaces. */}
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
            Privacy <span className="text-gradient">Policy</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-foreground/85">
            This Privacy Policy explains how AlgoSphere Quant (&ldquo;AlgoSphere,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, stores,
            shares, and protects your information when you use our website, dashboard,
            Telegram bot, and related services (collectively, the &ldquo;Service&rdquo;).
            By using the Service, you agree to the practices described here.
          </p>
        </header>

        <Section title="1. Who we are">
          <P>
            AlgoSphere Quant provides an AI-powered trader intelligence platform: trade
            journaling and analytics, behavioral and risk coaching, market intelligence,
            and optional broker connectivity for execution and account syncing. We are the
            data controller for the personal data processed through the Service.
          </P>
          <P>
            For any privacy question, or to exercise the rights described in Section&nbsp;9,
            contact us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-300 hover:underline">
              {CONTACT_EMAIL}
            </a>.
          </P>
        </Section>

        <Section title="2. Information we collect">
          <P>We collect the following categories of data:</P>
          <SubTitle>Account &amp; identity</SubTitle>
          <List items={[
            'Email address and name, provided directly or via Google OAuth sign-in.',
            'Authentication identifiers and session tokens, managed through our authentication provider (Supabase Auth).',
            'Optional profile details you add, such as your trader type and preferences.',
          ]} />

          <SubTitle>Trading &amp; usage data</SubTitle>
          <List items={[
            'Trade journal entries you create — instrument, direction, entry/exit, size, P&L, tags, notes, and any screenshots you upload.',
            'Trades and account equity automatically imported from brokers you choose to connect.',
            'Watchlists, strategies, backtests, alerts, and other content you generate in the app.',
            'Product usage and diagnostic data (pages visited, features used, device and browser metadata) used to operate and improve the Service.',
          ]} />

          <SubTitle>Broker connection data</SubTitle>
          <List items={[
            'Broker account identifiers, account/server labels, connection status, and synced equity.',
            'Broker API credentials (API keys, secrets, passphrases, or MetaTrader logins) that you choose to provide. These are encrypted before storage — see Section 6.',
          ]} />

          <SubTitle>Payment data</SubTitle>
          <List items={[
            'Subscription tier, status, and billing history.',
            'For cryptocurrency payments, transaction references and wallet/network metadata processed by our third-party payment processors. We do not store your private keys, and we do not receive or store full card numbers.',
          ]} />

          <SubTitle>Messaging data</SubTitle>
          <List items={[
            'If you link Telegram, we store your Telegram chat ID to deliver signals and account notifications.',
            'If you provide a number for messaging features, we store it to deliver the notifications you request.',
          ]} />
        </Section>

        <Section title="3. How we use your information">
          <List items={[
            'Provide, operate, and maintain the Service and your account.',
            'Generate your analytics, coaching, risk, and intelligence outputs from your own trading data.',
            'Sync, display, and (where you enable it) execute through connected broker accounts.',
            'Process subscriptions and payments and manage your access tier.',
            'Send service messages — security alerts, account and billing notices, and signals or notifications you opt into.',
            'Secure the Service, prevent fraud and abuse, and debug and improve features.',
            'Comply with legal obligations and enforce our Terms.',
          ]} />
        </Section>

        <Section title="4. Legal bases for processing">
          <P>
            Where the GDPR or similar laws apply, we rely on: <strong>performance of a
            contract</strong> (to provide the Service you sign up for); <strong>legitimate
            interests</strong> (to secure, maintain, and improve the Service);
            <strong> consent</strong> (for optional messaging channels and any
            non-essential analytics, which you can withdraw at any time); and
            <strong> legal obligation</strong> (for tax, accounting, and compliance).
          </P>
        </Section>

        <Section title="5. How we share information">
          <P>
            We do not sell your personal data. We share it only with service providers
            (&ldquo;sub-processors&rdquo;) who process it on our behalf, under contract, and
            only as needed to run the Service:
          </P>
          <List items={[
            'Cloud infrastructure & database — hosting, authentication, and storage of your account and content.',
            'Broker APIs — when you connect a broker, we exchange data with that broker to read your account and, if you enable it, place orders. Your relationship with the broker is also governed by the broker’s own privacy policy.',
            'Payment processors — cryptocurrency payment providers that handle your transactions.',
            'Messaging & email providers — to deliver Telegram notifications and transactional email.',
            'Market-data providers — we request market data from third parties to power intelligence features; we do not send your personal trading data to them.',
          ]} />
          <P>
            We may also disclose data if required by law, to protect our rights or users’
            safety, or in connection with a merger, acquisition, or sale of assets (you will
            be notified of any change in ownership affecting your data).
          </P>
        </Section>

        <Section title="6. How we protect broker credentials & data">
          <P>
            Security is foundational to how the Service is built:
          </P>
          <List items={[
            'Broker API credentials are encrypted with AES-256-GCM before they are written to the database. They are never exposed to the browser or front-end code.',
            'Only the server-side execution engine can decrypt credentials, and only to perform the broker actions you authorized.',
            'Row-Level Security isolates each account’s data so users can only access their own rows.',
            'Data is encrypted in transit (TLS) and access to production systems is restricted.',
          ]} />
          <P>
            No method of transmission or storage is 100% secure, but we work to protect your
            data using industry-standard safeguards and to notify you and regulators of any
            breach as required by law.
          </P>
        </Section>

        <Section title="7. Cookies & similar technologies">
          <P>
            We use strictly necessary cookies and local storage to keep you signed in, hold
            your session, and remember preferences. We may use privacy-respecting analytics
            to understand product usage. We do not use third-party advertising trackers. You
            can control cookies through your browser settings; disabling essential cookies
            may break sign-in and core features.
          </P>
        </Section>

        <Section title="8. Data retention">
          <P>
            We keep your data for as long as your account is active and as needed to provide
            the Service. If you delete content (such as a journal entry or broker connection)
            it is removed from active systems. When you close your account, we delete or
            anonymize your personal data within a reasonable period, except where we must
            retain certain records to meet legal, tax, accounting, or security obligations.
          </P>
        </Section>

        <Section title="9. Your rights">
          <P>
            Depending on where you live (including under the GDPR and CCPA/CPRA), you may have
            the right to:
          </P>
          <List items={[
            'Access the personal data we hold about you and request a copy (portability).',
            'Correct inaccurate or incomplete data.',
            'Delete your data (“right to be forgotten”), subject to legal retention limits.',
            'Restrict or object to certain processing, and withdraw consent for optional channels.',
            'Opt out of the “sale” or “sharing” of personal data — which we do not do.',
          ]} />
          <P>
            To exercise any of these rights, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-300 hover:underline">
              {CONTACT_EMAIL}
            </a>. We will respond within the timeframe required by applicable law. You also
            have the right to lodge a complaint with your local data protection authority.
          </P>
        </Section>

        <Section title="10. International transfers">
          <P>
            We and our sub-processors may process your data in countries other than your own.
            Where we transfer data internationally, we rely on appropriate safeguards (such as
            Standard Contractual Clauses) to protect it consistent with this policy.
          </P>
        </Section>

        <Section title="11. Children’s privacy">
          <P>
            The Service is not directed to anyone under 18, and we do not knowingly collect
            data from children. If you believe a minor has provided us data, contact us and we
            will delete it.
          </P>
        </Section>

        <Section title="12. Third-party links & brokers">
          <P>
            The Service links to third-party sites and lets you connect third-party broker
            accounts. We are not responsible for the privacy practices of those parties; we
            encourage you to review their policies. Connecting a broker is your choice and you
            can disconnect it at any time from the Brokers page.
          </P>
        </Section>

        <Section title="13. Trading disclaimer">
          <P>
            AlgoSphere provides educational and analytical tools, not financial advice.
            Trading involves substantial risk. This Privacy Policy governs data handling only
            and does not alter the risk disclosures in our Terms.
          </P>
        </Section>

        <Section title="14. Changes to this policy">
          <P>
            We may update this policy as the Service evolves. Material changes will be posted
            here with a new &ldquo;Last updated&rdquo; date, and where appropriate we will
            notify you by email or in-app. Continued use of the Service after changes take
            effect means you accept the revised policy.
          </P>
        </Section>

        <Section title="15. Contact us">
          <P>
            Questions, requests, or complaints about this policy or your data:
          </P>
          <P>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-300 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </P>
        </Section>
      </article>

      {/* Footer — matches the landing page footer. */}
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


// ─── Presentational helpers ─────────────────────────────────────────────

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
