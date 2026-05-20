'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Menu, X } from 'lucide-react'
import BrandLockup from '@/components/brand/BrandLockup'

const LINKS = [
  { href: '#features',     label: 'Features' },
  { href: '#how',          label: 'How it works' },
  { href: '#pricing',      label: 'Pricing' },
  { href: '/traders',      label: 'Leaderboard' },
  { href: '#faq',          label: 'FAQ' },
]

/**
 * Marketing header. Desktop: inline links. Mobile: a hamburger that
 * opens a portal-mounted fullscreen sheet.
 *
 * The portal is load-bearing: the surrounding <header> uses
 * `backdrop-blur`, which per CSS spec makes the header the
 * containing block for any `position: fixed` descendant. Without
 * the portal the drawer would be clipped to the header's box —
 * exactly the "hero text bleeding through" symptom we hit before.
 */
export default function MarketingNav() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // TEMP debug marker — remove once portal architecture is confirmed live.
    // eslint-disable-next-line no-console
    console.log('[NAV TRACE] MarketingNav mounted')
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __NAV_BUILD?: string }).__NAV_BUILD = 'PORTAL_FIX_V3'
    }
  }, [])

  // Body-scroll lock while the mobile drawer is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const drawer = (
    <div
      data-marketing-drawer-root
      // Modal semantics on inner <aside role="dialog" aria-modal="true">.
      className={open ? 'pointer-events-auto' : 'pointer-events-none'}
    >
      {/* Scoped style override: pin solid black + white inside the
          drawer so in-app browsers can never render it washed-out. */}
      <style>{`
        [data-marketing-drawer-panel] { background: #000 !important; }
        [data-marketing-drawer-panel], [data-marketing-drawer-panel] * { color: #ffffff !important; }
      `}</style>

      {/* Overlay */}
      <div
        onClick={() => setOpen(false)}
        className={
          'fixed inset-0 z-[9998] bg-black/80 md:hidden ' +
          'transition-opacity duration-200 ' +
          (open ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
        aria-hidden
      />

      {/* Panel — right-side sheet */}
      <aside
        data-marketing-drawer-panel
        role="dialog"
        aria-modal="true"
        aria-label="Marketing navigation"
        className={
          'fixed top-0 right-0 z-[9999] md:hidden ' +
          'flex flex-col ' +
          'w-[85vw] max-w-[360px] ' +
          'h-[100dvh] ' +
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ' +
          'border-l border-white/10 bg-black ' +
          'shadow-2xl ' +
          'transition-transform duration-200 ease-out will-change-transform ' +
          (open ? 'translate-x-0' : 'translate-x-full pointer-events-none')
        }
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <BrandLockup />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 touch-manipulation"
          >
            <X className="h-5 w-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-base font-medium hover:bg-white/10"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-white/10 px-5 py-5">
          <a
            href="/login"
            onClick={() => setOpen(false)}
            className="inline-flex w-full items-center justify-center rounded-lg border border-white/20 px-4 py-3 text-sm font-semibold hover:bg-white/10"
          >
            Sign in
          </a>
          <a
            href="/signup"
            onClick={() => setOpen(false)}
            className="btn-premium w-full justify-center !py-3"
          >
            Start free trial
          </a>
        </div>
      </aside>
    </div>
  )

  return (
    <header
      data-nav-trace="MarketingNav"
      className="sticky top-0 z-50 border-t-[6px] border-t-red-500 border-b border-border bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <BrandLockup priority />

        <nav className="hidden gap-6 text-sm md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="/login"
            className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline"
          >
            Sign in
          </a>
          <a
            href="/signup"
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:px-4 sm:text-sm"
          >
            Start free
          </a>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-haspopup="dialog"
            className="-mr-1 inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted/40 md:hidden touch-manipulation"
          >
            <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {mounted && createPortal(drawer, document.body)}
    </header>
  )
}
