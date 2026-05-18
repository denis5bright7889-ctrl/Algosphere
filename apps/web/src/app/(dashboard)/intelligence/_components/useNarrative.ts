'use client'

import { useEffect, useState } from 'react'
import type { ProviderNarrative } from '@/services/onchain/types'

/**
 * AI narrative fetch hook. Only fires when `enabled` (ELITE+ via
 * `ent.aiNarratives`) — lower bands never hit the gated endpoint, so
 * no 403 noise. Returns the narrative or null; the caller renders the
 * summary card only when a body comes back.
 */
export function useIntelNarrative(
  surface: ProviderNarrative['surface'],
  enabled: boolean,
) {
  const [narrative, setNarrative] = useState<ProviderNarrative | null>(null)

  useEffect(() => {
    if (!enabled) { setNarrative(null); return }
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/onchain/narrative/${surface}`)
        if (!res.ok) return
        const json = await res.json().catch(() => ({}))
        if (alive && json?.narrative) setNarrative(json.narrative as ProviderNarrative)
      } catch { /* narrative is best-effort — never blocks the page */ }
    })()
    return () => { alive = false }
  }, [surface, enabled])

  return narrative
}
