'use client'

import { useEffect, useState, useCallback } from 'react'

export interface IntelMeta {
  source:        string
  fetched_at:    string
  delayed:       boolean
  band:          'FREE' | 'PRO' | 'ELITE' | 'INSTITUTIONAL'
  capped:        boolean
  delay_minutes: number
}

interface State<T> {
  data:    T[]
  meta:    IntelMeta | null
  loading: boolean
  error:   string | null
}

/**
 * Generic fetch hook for any /api/onchain/* endpoint. The UI never
 * knows which provider answered — it just renders typed rows + the
 * transparency meta (source / delayed / band).
 */
export function useIntel<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
) {
  const [s, setS] = useState<State<T>>({ data: [], meta: null, loading: true, error: null })

  const key = JSON.stringify(params)
  const load = useCallback(async () => {
    setS((p) => ({ ...p, loading: true, error: null }))
    try {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      const res = await fetch(`/api/onchain/${endpoint}?${qs.toString()}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setS({
        data:    Array.isArray(json.data) ? json.data : [],
        meta:    {
          source: json.source, fetched_at: json.fetched_at,
          delayed: !!json.delayed, band: json.band,
          capped: !!json.capped, delay_minutes: json.delay_minutes ?? 0,
        },
        loading: false,
        error:   null,
      })
    } catch (e) {
      setS((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : 'Failed' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, key])

  useEffect(() => { load() }, [load])

  return { ...s, reload: load }
}
