'use client'

/**
 * IntelligenceGrid — the Analyze-Mode workspace (Bloomberg-style).
 *
 * Replaces the old link-list intelligence index. Fetches the consolidated
 * grid payload (real Decision-Brain signals), renders a verdict banner +
 * a responsive card grid, and opens a right-side drawer on card click —
 * never a page navigation. Polls every 60s for live refresh; modules
 * whose status changed since the last poll get a subtle (non-flashing)
 * ring so the eye catches what moved.
 *
 * Honesty: every number is from the engines. While loading → skeletons;
 * on error → an explicit message; unavailable engines → "Awaiting".
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GridPayload, IntelligenceModule } from '@/lib/intelligence/grid-types'
import IntelligenceCard from './IntelligenceCard'
import ExpandDrawer from './ExpandDrawer'

const POLL_MS = 60_000

export default function IntelligenceGrid() {
  const [data, setData] = useState<GridPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<IntelligenceModule | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())

  const prevStatus = useRef<Map<string, string>>(new Map())
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true); else setRefreshing(true)
    try {
      const res = await fetch('/api/intelligence/grid', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`)
      const payload = (await res.json()) as GridPayload

      // Diff statuses vs the previous poll for the subtle "moved" ring.
      if (prevStatus.current.size > 0) {
        const moved = new Set<string>()
        for (const m of payload.modules) {
          if (prevStatus.current.get(m.key) !== m.status) moved.add(m.key)
        }
        if (moved.size) {
          setChanged(moved)
          if (clearTimer.current) clearTimeout(clearTimer.current)
          clearTimer.current = setTimeout(() => setChanged(new Set()), 4000)
        }
      }
      prevStatus.current = new Map(payload.modules.map((m) => [m.key, m.status]))

      setData(payload)
      setError(null)
      // Keep the open drawer's content fresh on refresh.
      setSelected((cur) => cur ? payload.modules.find((m) => m.key === cur.key) ?? cur : cur)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load intelligence')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), POLL_MS)
    return () => {
      clearInterval(id)
      if (clearTimer.current) clearTimeout(clearTimer.current)
    }
  }, [load])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      {/* Header */}
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Market <span className="text-gradient">Intelligence</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Live AI intelligence grid — regime, flows, breadth, volatility in one decision surface.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(false)}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>Intelligence feed unavailable: {error}. Retrying on the next poll.</span>
        </div>
      )}

      {/* Verdict banner */}
      {data && <VerdictBanner data={data} />}

      {/* Grid */}
      {loading ? (
        <SkeletonGrid />
      ) : data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.modules.map((m) => (
            <IntelligenceCard
              key={m.key} module={m}
              changed={changed.has(m.key)}
              onExpand={setSelected}
            />
          ))}
        </div>
      ) : null}

      <ExpandDrawer module={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function VerdictBanner({ data }: { data: GridPayload }) {
  const v = data.verdict
  const tone =
    v.directionBias === 'LONG' ? 'text-emerald-300'
    : v.directionBias === 'SHORT' ? 'text-rose-300'
    : 'text-amber-300'
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">AI Verdict</p>
          <p className={cn('text-xl font-bold tracking-tight', tone)}>
            {v.marketState.replace('_', ' ')} · {v.directionBias}
          </p>
        </div>
        <Stat label="Confidence" value={`${Math.round(v.confidence)}%`} />
        <Stat label="Risk" value={v.riskLevel} />
        <Stat label="Action" value={v.tradePermission} />
        <Stat label="Engines live" value={`${data.availableCount}/${data.modules.length}`} />
        <p className="ml-auto hidden max-w-xs text-[11px] leading-snug text-muted-foreground lg:block">
          {v.explanation[0] ?? '—'}
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-bold tabular-nums">{value}</p>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="h-[132px] animate-pulse rounded-xl border border-border/60 bg-card/60" />
      ))}
    </div>
  )
}
