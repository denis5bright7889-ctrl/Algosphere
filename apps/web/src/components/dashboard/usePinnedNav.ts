'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Per-device pinned-nav favourites. Pure UI preference → localStorage,
 * no DB/API. Two Sidebar instances exist at once (desktop rail +
 * mobile drawer); a custom window event keeps them live-synced, and
 * the native `storage` event syncs across tabs.
 */
const LS_KEY  = 'as_pinned_nav'
const EVT     = 'as-pinned-nav-change'

function read(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function usePinnedNav() {
  const [pinned, setPinned] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setPinned(read())
    setMounted(true)
    const sync = () => setPinned(read())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const toggle = useCallback((href: string) => {
    setPinned((prev) => {
      const next = prev.includes(href)
        ? prev.filter((h) => h !== href)
        : [...prev, href]
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next))
        window.dispatchEvent(new Event(EVT))
      } catch { /* storage disabled — stays in-memory for this instance */ }
      return next
    })
  }, [])

  return { pinned, toggle, mounted }
}
