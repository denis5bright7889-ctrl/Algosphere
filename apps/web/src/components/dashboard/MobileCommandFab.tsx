'use client'

import { Command } from 'lucide-react'

/**
 * Mobile quick-command FAB (beta). The ⌘K palette had no touch entry
 * point inside the app (the desktop trigger is `hidden md:block`), so
 * mobile users had no fast search/jump. This floats in the right-hand
 * thumb zone, just above the bottom nav, and opens the existing
 * palette via the same global event — zero new logic, no duplication.
 */
export default function MobileCommandFab() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
      aria-label="Quick command — search & jump"
      className={
        'fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full md:hidden ' +
        'bg-gradient-primary text-black shadow-glow-gold transition-transform active:scale-95 ' +
        // Sit just above the floating bottom tab bar + safe area.
        'bottom-[calc(82px+env(safe-area-inset-bottom))]'
      }
    >
      <Command className="h-5 w-5" strokeWidth={2.25} aria-hidden />
    </button>
  )
}
