import Logo from '@/components/brand/Logo'
import EnterpriseEnquiryForm from './EnterpriseEnquiryForm'

export const metadata = {
  title: 'Enterprise & White-Label — AlgoSphere Quant',
  description:
    'Multi-seat licensing, white-label branding, broker partnerships, and dedicated SLAs.',
}

const TIERS = [
  {
    name:     'Team',
    price:    '$199 / seat / month',
    minSeats: 10,
    note:     'Quants and trading desks',
    features: [
      'Up to 50 seats',
      'Shared signal & strategy workspace',
      'Admin user management',
      'API access: 5K calls/min/seat',
      '99.5% SLA',
    ],
  },
  {
    name:     'Business',
    price:    '$5,000 / month flat',
    minSeats: 50,
    note:     'Prop firms & funds',
    badge:    'Most popular',
    features: [
      'Up to 250 seats',
      'SSO (Google Workspace, Okta, SAML)',
      'Audit logs + compliance export',
      'White-label reports',
      'API: 100K calls/min',
      '99.9% SLA · dedicated CSM',
    ],
  },
  {
    name:     'White Label',
    price:    '$15,000 / month',
    minSeats: 0,
    note:     'Brokers and IBs',
    features: [
      'Unlimited seats',
      'Custom domain + branding',
      'Full white-label UI',
      'Co-branded mobile experience',
      'Revenue share on subscriptions',
      '99.99% SLA · 24/7 priority support',
    ],
  },
] as const

export default function EnterprisePage() {
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

      <section className="relative mx-auto max-w-6xl px-4 py-14 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh opacity-40 pointer-events-none" aria-hidden />

        <div className="relative text-center mb-12">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase mb-4">
            Enterprise · White-Label · Broker Partnerships
          </span>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
            Trade infrastructure for{' '}
            <span className="text-gradient">institutions</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Deploy AlgoSphere Quant under your brand. Multi-seat licensing, SSO,
            audit logs, white-label reports, and a 99.99% SLA.
          </p>
        </div>

        {/* Tier cards */}
        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-4 mb-12">
          {TIERS.map(t => (
            <div
              key={t.name}
              className="relative rounded-2xl border border-border bg-card p-6 flex flex-col"
            >
              {'badge' in t && t.badge && (
                <span className="absolute -top-2.5 left-6 rounded-full border border-amber-500/50 bg-amber-500/15 px-3 py-0.5 text-[10px] font-bold text-amber-300">
                  {t.badge}
                </span>
              )}
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                {t.name}
              </p>
              <p className="text-2xl font-bold mt-2 tabular-nums">{t.price}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{t.note}</p>
              <ul className="mt-5 space-y-1.5">
                {t.features.map(f => (
                  <li key={f} className="text-xs text-muted-foreground flex gap-2">
                    <span className="text-amber-300">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {t.minSeats > 0 && (
                <p className="mt-4 text-[10px] text-muted-foreground">
                  Minimum {t.minSeats} seats
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Lead form */}
        <div className="relative rounded-2xl border border-border bg-card p-6 sm:p-8 max-w-2xl mx-auto">
          <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
          <h2 className="text-xl font-bold tracking-tight mb-1">Talk to sales</h2>
          <p className="text-xs text-muted-foreground mb-6">
            We&apos;ll reach out within 1 business day with pricing and a tailored deployment plan.
          </p>
          <EnterpriseEnquiryForm />
        </div>
      </section>
    </main>
  )
}
