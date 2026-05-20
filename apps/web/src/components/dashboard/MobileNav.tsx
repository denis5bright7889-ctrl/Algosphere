'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Menu, X } from 'lucide-react'
import Sidebar from './Sidebar'
import type { Tier } from './nav'
import Logo from '@/components/brand/Logo'

interface Props {
  tier?:    Tier
  isAdmin?: boolean
}

/**
 * Mobile drawer. Rendered through a portal to document.body so it
 * escapes the dashboard <header>'s stacking context and containing
 * block — the header uses `backdrop-filter` (via .glass), which per
 * CSS spec makes it the containing block for any `position: fixed`
 * descendant. Without the portal the drawer would be clipped to the
 * 56px header strip (the bug we just fixed).
 */
export default function MobileNav({ tier = 'free', isAdmin = false }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Portal target only exists on the client — wait one tick before
  // rendering anything that depends on document.body.
  useEffect(() => { setMounted(true) }, [])

  // Body-scroll lock while open: stops the page beneath from
  // scrolling on touch and prevents iOS rubber-banding through the
  // overlay. Restores the previous overflow value on close/unmount.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Esc to close — small ergonomic win on tablets with keyboards.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const drawer = (
    <div
      data-mobile-drawer-root
      // Modal semantics live on the inner <aside role="dialog"
      // aria-modal="true"> — that's the canonical signal for screen
      // readers. The wrapper just gates pointer events.
      className={open ? 'pointer-events-auto' : 'pointer-events-none'}
    >
      {/* Scoped style override: in-app browsers (Telegram, Samsung
          Internet, Chrome Custom Tabs) sometimes mis-render the
          theme's CSS custom properties. Pin solid black + white
          inside the drawer so legibility is never in question. */}
      <style>{`
        [data-mobile-drawer-panel] { background: #000 !important; }
        [data-mobile-drawer-panel], [data-mobile-drawer-panel] * { color: #ffffff !important; }
        [data-mobile-drawer-panel] .text-amber-300,
        [data-mobile-drawer-panel] .text-amber-300\\/80 { color: #fcd34d !important; }
        [data-mobile-drawer-panel] .text-rose-300\\/80 { color: #fda4af !important; }
      `}</style>

      {/* Overlay — full viewport dim, click to close */}
      <div
        onClick={() => setOpen(false)}
        className={
          'fixed inset-0 z-[9998] bg-black/80 md:hidden ' +
          'transition-opacity duration-200 ' +
          (open ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
        aria-hidden
      />

      {/* Panel — fixed to viewport, full height incl. iOS dynamic
          viewport (100dvh) so mobile URL-bar collapse doesn't crop
          the bottom. Translated off-screen when closed so the slide
          animation works on both open and close. */}
      <aside
        data-mobile-drawer-panel
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        className={
          'fixed top-0 left-0 z-[9999] md:hidden ' +
          'flex flex-col ' +
          'w-[85vw] max-w-[360px] ' +
          'h-[100dvh] ' +
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ' +
          'border-r border-white/10 bg-black ' +
          'shadow-2xl ' +
          'transition-transform duration-200 ease-out will-change-transform ' +
          (open ? 'translate-x-0' : '-translate-x-full pointer-events-none')
        }
      >
        {/* Sticky header inside the panel */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-black px-4 py-4">
          <a
            href="/overview"
            onClick={() => setOpen(false)}
            className="flex min-w-0 items-center gap-2"
          >
            <Logo size="sm" alt="" />
            <span className="truncate text-base font-bold tracking-tight">
              AlgoSphere Quant
            </span>
          </a>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 touch-manipulation"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4">
          <Sidebar
            onNavigate={() => setOpen(false)}
            tier={tier}
            isAdmin={isAdmin}
            exclusive
          />
        </div>
      </aside>
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent touch-manipulation"
        aria-label="Open menu"
        aria-haspopup="dialog"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>

      {mounted && createPortal(drawer, document.body)}
    </>
  )
}
