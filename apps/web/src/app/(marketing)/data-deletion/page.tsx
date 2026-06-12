import type { ReactNode } from 'react'
import Logo from '@/components/brand/Logo'
import { PRIVACY_EMAIL, SUPPORT_EMAIL } from '@/lib/brand'

export const metadata = {
  title: 'Data Deletion — AlgoSphere Quant',
  description:
    'How to delete your AlgoSphere Quant account and have your personal data erased — what we remove, what we must retain, and how long it takes.',
}

const LAST_UPDATED = 'June 1, 2026'

export default function DataDeletionPage() {
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
            Data <span className="text-gradient">Deletion</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-foreground/85">
            You have the right to ask us to delete your AlgoSphere Quant account and the
            personal data associated with it. This page explains how to make the
            request, what we delete, what we must lawfully retain, and how long the
            process takes. For the broader policy, see our{' '}
            <a href="/privacy" className="text-amber-300 hover:underline">Privacy Policy</a>.
          </p>
        </header>

        <Section title="1. The simplest way — self-serve from settings">
          <P>
            If you are signed in, the fastest path is the self-serve flow:
          </P>
          <List items={[
            'Open Settings → Account.',
            'Choose "Delete account."',
            'Confirm with your password (or your OAuth provider) so we know it\'s you.',
            'Your account is closed immediately and erasure starts on the schedule in Section 4.',
          ]} />
          <P>
            If you can’t sign in, use the email request flow in Section&nbsp;2.
          </P>
        </Section>

        <Section title="2. Email request (when you can’t sign in)">
          <P>
            Email{' '}
            <a href={`mailto:${PRIVACY_EMAIL}?subject=Data%20deletion%20request`} className="text-amber-300 hover:underline">
              {PRIVACY_EMAIL}
            </a>{' '}
            from the address associated with your account and include:
          </P>
          <List items={[
            'The email or account identifier you used to sign up.',
            'A short statement of your request — e.g., "Please delete my AlgoSphere Quant account and personal data."',
            'Any other identifier that helps us locate your records (Telegram username, referral code, broker connection label).',
          ]} />
          <P>
            We may need to verify your identity before acting on the request. We will
            not ask for sensitive data we don’t already hold (e.g., government ID is
            not required for ordinary deletion requests).
          </P>
        </Section>

        <Section title="3. What we delete">
          <P>
            On a verified deletion request, we delete or irreversibly anonymize:
          </P>
          <List items={[
            'Account profile data — name, email, password hash, photo, preferences.',
            'Authentication records — sessions, OAuth identifiers, recovery factors.',
            'Trading journal entries, notes, screenshots, tags, and analytics derived only from your data.',
            'Connected broker credentials and API keys, and any broker accounts linked through us.',
            'Telegram and WhatsApp identifiers (chat ID, handle) and your message history that we stored.',
            'Behavioral coaching state (psychology profile, evaluation grades, advancement state).',
            'Watchlists, alerts, and notification preferences.',
            'Affiliate / referral state where you were the referrer or referred, except where retention is required for tax or anti-fraud purposes (see Section 5).',
          ]} />
        </Section>

        <Section title="4. Timeline">
          <P>
            Active deletion begins immediately:
          </P>
          <List items={[
            'Account is disabled and you are signed out on all devices within minutes.',
            'Personal data in our primary systems is deleted or anonymized within 30 days.',
            'Encrypted backups roll off within 90 days and your data is not restored from them.',
            'Aggregated statistics that no longer identify you (e.g., anonymized strategy benchmarks) are not personal data and are not deleted.',
          ]} />
        </Section>

        <Section title="5. What we may need to keep">
          <P>
            Some information has to be retained for legitimate, lawful purposes even
            after deletion of your account. We keep the minimum necessary, separate
            from your active account record, and only for as long as the relevant
            obligation lasts:
          </P>
          <List items={[
            'Financial / payment records required by tax and accounting law (typically 5–7 years).',
            'Records needed to detect, prevent, or investigate fraud, abuse, security incidents, sanctions violations, or unlawful activity.',
            'Information required to enforce our Terms, defend legal claims, or comply with a lawful order from a competent authority.',
            'Logs that have already been anonymized (no longer identify you individually) — these are not personal data.',
          ]} />
        </Section>

        <Section title="6. Third-party systems">
          <P>
            Some data is processed by third parties on our behalf (for example, our
            payment processors, email delivery, analytics, broker APIs you connected).
            When you delete your AlgoSphere account, we instruct those processors to
            delete the personal data they hold for you, subject to their own legal
            retention obligations.
          </P>
          <P>
            Data you provided directly to a third party (e.g., on-chain wallet
            transactions, public broker statements) is not under our control and is not
            within the scope of this process. To delete those records you should follow
            that provider’s own data-deletion process.
          </P>
        </Section>

        <Section title="7. After deletion">
          <P>
            Deletion is permanent. We cannot restore an account after the 30-day
            window — including journal history, screenshots, analytics, broker
            connections, or referral state. If you want to use AlgoSphere again later,
            you will need to create a new account, and prior subscriptions or referral
            credits will not carry over.
          </P>
        </Section>

        <Section title="8. Withdrawing a pending request">
          <P>
            If you change your mind before the 30-day primary-system erasure completes,
            email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Cancel%20deletion%20request`} className="text-amber-300 hover:underline">
              {SUPPORT_EMAIL}
            </a>{' '}
            from the same address. After the 30-day window the request can no longer
            be withdrawn.
          </P>
        </Section>

        <Section title="9. Questions & escalation">
          <P>
            Questions, complaints, or escalations about a data-deletion request:
          </P>
          <P>
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-amber-300 hover:underline">
              {PRIVACY_EMAIL}
            </a>
          </P>
          <P>
            If you believe we have not handled your request lawfully, you also have the
            right to lodge a complaint with your local data protection authority. We
            ask that you contact us first so we can try to resolve it.
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
