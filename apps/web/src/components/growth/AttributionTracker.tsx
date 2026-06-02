'use client'

/**
 * AttributionTracker — drops one pageview into /api/track/event on
 * every route change. Mount once at the root layout. Safe to import
 * from any client subtree (idempotent — re-mount fires zero extra
 * events).
 *
 * Path changes deduped via a ref so a Strict-Mode double-mount in
 * dev doesn't double-count.
 */
import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { track } from '@/lib/tracking/client'

export default function AttributionTracker() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const lastPath     = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    const qs   = searchParams?.toString() ?? ''
    const full = qs ? `${pathname}?${qs}` : pathname
    if (lastPath.current === full) return
    lastPath.current = full
    track({ event: 'pageview' })
  }, [pathname, searchParams])

  return null
}
