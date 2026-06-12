import Link from 'next/link'
import {
  BRAND_NAME, BRAND_DOMAIN, CONTACT_EMAIL,
  PRIVACY_EMAIL, LEGAL_EMAIL, INVESTORS_EMAIL, PRESS_EMAIL, SUPPORT_EMAIL,
} from '@/lib/brand'

/**
 * Institutional marketing footer. Renders on every (marketing) route
 * via the route-group layout. Five-column information architecture:
 *
 *   1. Brand + tagline + contact      ← canonical email lives here
 *   2. Product                        ← /signals · /validation · /workspace
 *   3. Company                        ← /investors · /deck · /enterprise
 *   4. Legal                          ← /privacy · /terms · /data-deletion
 *   5. Get in touch                   ← per-channel emails
 *
 * Mobile collapses to a stacked single column. The canonical contact
 * email is exposed at every level so visitors don't have to dig.
 */
export default function MarketingFooter() {
  const year = new Date().getUTCFullYear()
  return (
    <footer className="border-t border-border/40 bg-background/95">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <Link href="/" className="text-base font-bold">
              <span className="text-gradient">AlgoSphere</span> Quant
            </Link>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground max-w-sm">
              Every strategy must earn the right to trade live. Institutional
              Trader Performance Intelligence — shipped end-to-end, honest by
              construction.
            </p>
            <p className="mt-4 text-[11px] text-muted-foreground">
              <span className="block text-muted-foreground/70 uppercase tracking-wider text-[10px] mb-1">Contact</span>
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-300 hover:underline tabular-nums">
                {CONTACT_EMAIL}
              </a>
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              {BRAND_DOMAIN}
            </p>
          </div>

          {/* Product */}
          <FooterCol title="Product">
            <FooterLink href="/signals">Signals</FooterLink>
            <FooterLink href="/validation">Validation Center</FooterLink>
            <FooterLink href="/workspace">Workspace</FooterLink>
            <FooterLink href="/blog">Blog</FooterLink>
            <FooterLink href="/live">Live engine</FooterLink>
          </FooterCol>

          {/* Company */}
          <FooterCol title="Company">
            <FooterLink href="/investors">Investors</FooterLink>
            <FooterLink href="/deck">Pitch deck</FooterLink>
            <FooterLink href="/enterprise">Enterprise</FooterLink>
            <FooterLink href="/pricing">Pricing</FooterLink>
          </FooterCol>

          {/* Legal */}
          <FooterCol title="Legal">
            <FooterLink href="/privacy">Privacy</FooterLink>
            <FooterLink href="/terms">Terms</FooterLink>
            <FooterLink href="/data-deletion">Data deletion</FooterLink>
          </FooterCol>
        </div>

        {/* Get in touch row — per-channel emails currently route to
            the canonical inbox; named so visitors set expectations. */}
        <div className="mt-10 border-t border-border/40 pt-6">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-3">
            Get in touch
          </p>
          <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-[12px] sm:grid-cols-3 md:grid-cols-5">
            <ContactRow label="General"  email={CONTACT_EMAIL} />
            <ContactRow label="Support"  email={SUPPORT_EMAIL} />
            <ContactRow label="Privacy"  email={PRIVACY_EMAIL} />
            <ContactRow label="Legal"    email={LEGAL_EMAIL} />
            <ContactRow label="Press"    email={PRESS_EMAIL} />
            <ContactRow label="Investors" email={INVESTORS_EMAIL} />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-6 text-[10px] text-muted-foreground/70">
          <p>© {year} {BRAND_NAME}. All rights reserved.</p>
          <p>Not financial advice. Trading involves risk of loss.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-3">
        {title}
      </p>
      <ul className="space-y-1.5 text-[12px]">
        {children}
      </ul>
    </div>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-muted-foreground hover:text-foreground">
        {children}
      </Link>
    </li>
  )
}

function ContactRow({ label, email }: { label: string; email: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground/70 min-w-[64px]">{label}</span>
      <a href={`mailto:${email}`} className="text-amber-300 hover:underline truncate">
        {email}
      </a>
    </div>
  )
}
