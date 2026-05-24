'use client'
/**
 * useDashboard — client polling hook for GET /api/dashboard.
 *
 * No new deps (plain fetch + interval), matching the existing hook style.
 * Visibility-aware: pauses while the tab is hidden and refetches on focus,
 * so we don't hammer the API in background tabs. Aborts the in-flight
 * request on unmount/refetch. This is the realtime feed the /command page
 * header anticipated; it degrades to the last good snapshot on error.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface DashboardKpis {
  total_notional: number
  exposure_cap_usd: number | null
  exposure_cap_pct: number | null
  open_positions: number
  max_open_positions: number | null
  daily_realized_pnl: number
  daily_loss_cap_usd: number | null
  cumulative_realized_pnl: number
  drawdown_usd: number
  max_drawdown_usd: number | null
  drawdown_cap_pct: number | null
  concentration_pct: number | null
  max_concentration_pct: number | null
  discipline_score: number | null
  win_rate: number | null
  loss_streak: number
  trades: number
  open_desyncs: number
  queue_depth: number
  queued: number
  claimed: number
}

export interface DashboardSnapshot {
  kill: { active: boolean; reason: string | null; activated_at: string | null }
  kpis: DashboardKpis
  copy_health: unknown[]
  coach_alerts: unknown[]
  reconciliation: unknown[]
  recent_jobs: unknown[]
  generated_at: string
}

interface UseDashboard {
  data: DashboardSnapshot | null
  error: string | null
  loading: boolean
  lastUpdated: number | null
  refetch: () => void
}

export function useDashboard(intervalMs = 10_000): UseDashboard {
  const [data, setData] = useState<DashboardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch('/api/dashboard', { signal: ac.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`dashboard ${res.status}`)
      const json = (await res.json()) as DashboardSnapshot
      setData(json)
      setError(null)
      setLastUpdated(Date.now())
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // Keep the last good snapshot; surface the error non-destructively.
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) return
      load()
      timer = setInterval(load, intervalMs)
    }
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
      abortRef.current?.abort()
    }
  }, [load, intervalMs])

  return { data, error, loading, lastUpdated, refetch: load }
}
