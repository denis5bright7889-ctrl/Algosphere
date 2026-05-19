'use client'

import { useEffect, useState } from 'react'
import type { UniverseQuote } from '@/lib/quotes'

export interface QuotesState {
  quotes:    Map<string, UniverseQuote>
  providers: { 'crypto-stream': boolean; twelvedata: boolean; finnhub: boolean }
  loading:   boolean
  error:     string | null
  fetchedAt: string | null
}

const EMPTY_PROVIDERS = { 'crypto-stream': true, twelvedata: false, finnhub: false }
const POLL_MS = 15_000  // matches server-side Next fetch revalidate

/**
 * Polled batch quote fetch for non-crypto instruments. Visibility-aware
 * (pauses when the tab is hidden, resumes on visible). The server
 * itself caches identical URLs for 15s, so reasonable polling here
 * costs nothing on the upstream provider's quota.
 *
 * Returns the latest quotes Map plus the providers metadata so each
 * row can render "Feed not connected" vs "fetching…" vs real price
 * truthfully.
 */
export function useInstrumentQuotes(symbols: string[]): QuotesState {
  const key = symbols.join(',')
  const [s, setS] = useState<QuotesState>({
    quotes:    new Map(),
    providers: EMPTY_PROVIDERS,
    loading:   true,
    error:     null,
    fetchedAt: null,
  })

  useEffect(() => {
    if (!key) {
      setS({ quotes: new Map(), providers: EMPTY_PROVIDERS, loading: false, error: null, fetchedAt: null })
      return
    }

    let alive = true
    async function load() {
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null) as
          | { quotes: UniverseQuote[]; meta: { providers: QuotesState['providers']; fetched_at: string } }
          | { error: string }
          | null
        if (!alive || !json) return
        if ('error' in json) { setS((p) => ({ ...p, loading: false, error: json.error })); return }
        const map = new Map<string, UniverseQuote>()
        for (const q of json.quotes) map.set(q.symbol, q)
        setS({ quotes: map, providers: json.meta.providers, loading: false, error: null, fetchedAt: json.meta.fetched_at })
      } catch (e) {
        if (alive) setS((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : 'fetch failed' }))
      }
    }
    void load()

    let id: ReturnType<typeof setInterval> | null = setInterval(load, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void load()
        if (!id) id = setInterval(load, POLL_MS)
      } else if (id) { clearInterval(id); id = null }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      alive = false
      if (id) clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [key])

  return s
}
