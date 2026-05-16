'use client'

import { Search } from 'lucide-react'

/** Visible affordance for the ⌘K palette (and the only way to open it
 *  on touch devices with no keyboard). */
export default function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
      aria-label="Search navigation"
      className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden sm:inline rounded border border-border/70 px-1 py-0.5 text-[10px] leading-none">⌘K</kbd>
    </button>
  )
}
