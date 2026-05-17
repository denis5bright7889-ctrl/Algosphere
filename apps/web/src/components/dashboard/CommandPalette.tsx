'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Heavy panel — lucide icons, NAV_FLAT, filter logic. Lazy-loaded
// only after the user actually triggers the palette so it stays
// out of the initial dashboard bundle.
const CommandPaletteImpl = dynamic(() => import('./CommandPaletteImpl'), {
  ssr:    false,
  loading: () => null,
})

/**
 * Eager wrapper for the ⌘K palette. Registers the global hotkey +
 * 'open-command-palette' event listener on mount (cheap), and only
 * mounts the heavy <CommandPaletteImpl> after the first activation.
 *
 * Once mounted, the impl stays in memory for fast subsequent opens.
 */
export default function CommandPalette() {
  const [open, setOpen]     = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setLoaded(true)
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    function onOpenEvent() {
      setLoaded(true)
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpenEvent)
    }
  }, [])

  if (!loaded) return null
  return <CommandPaletteImpl open={open} onClose={() => setOpen(false)} />
}
