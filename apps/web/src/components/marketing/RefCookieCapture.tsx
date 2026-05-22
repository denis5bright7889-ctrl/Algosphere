'use client'

import { useEffect } from 'react'
import { writeRefCookie } from '@/lib/referrals'

/**
 * Tiny client-only effect that runs on marketing pages. If the URL
 * has a ?ref= param, it pins it as a cookie so the user's eventual
 * signup carries the same code even if they navigate around first.
 *
 * Drop this near the root of the marketing layout. Does NOT render
 * anything visible.
 */
export default function RefCookieCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const raw = params.get('ref')
      if (raw) writeRefCookie(raw)
    } catch {
      /* never let the marketing page error from this */
    }
  }, [])

  return null
}
