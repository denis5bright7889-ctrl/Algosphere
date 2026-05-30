'use client'

/**
 * IntelligenceGrid — the Market Intelligence workspace (Refocus V3).
 *
 * The founder spec consolidates 17 fragmented engine pages into 7
 * thematic sections; this surface delivers six of them (the verdict
 * banner above already serves as Market Pulse):
 *
 *   1. Market Pulse        — verdict banner (consolidated AI score)
 *   2. Market Regime       — regime engine
 *   3. Liquidity & Flows   — smartMoney, whaleFlow + stablecoin/exchange
 *   4. Sentiment Engine    — narrative · attention · participation
 *   5. Rotation Engine     — dominance, breadth + sectors / rotation
 *   6. Momentum Engine     — momentum + conviction / positioning / tokens
 *   7. Volatility & Stress — volatility, correlation, execution + stress
 *
 * Each section pulls the live Decision-Brain modules that fit and
 * exposes a "Deep dive" link rail to the surviving sub-pages — those
 * routes still work as standalone views, but the nav now leads here.
 *
 * Same backing data as before (one `/api/intelligence/grid` poll, no
 * per-section fetch fan-out), same ExpandDrawer interaction. Modules
 * not covered by any section fall into a catch-all bucket so a future
 * engine never silently disappears from the surface.
 *
 * Honesty: every number is from the engines. While loading → skeletons;
 * on error → an explicit message; unavailable engines → "Awaiting".
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import {
  RefreshCw, AlertTriangle, Radar, Waves, MessagesSquare,
  Repeat, Rocket, Activity, ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GridPayload, IntelligenceModule } from '@/lib/intelligence/grid-types'
import IntelligenceCard from './IntelligenceCard'
import ExpandDrawer from './ExpandDrawer'

interface Section {
  key:        string
  title:      string
  subtitle:   string
  icon:       LucideIcon
  /** Decision-Brain module keys that belong in this section. */
  moduleKeys: string[]
  /** Deep-dive links to surviving sub-pages — still routable. */
  links:      Array<{ label: string; href: string }>
}

const SECTIONS: Section[] = [
  {
    key: 'regime',
    title: 'Market Regime',
    subtitle: 'Trending · Ranging · Risk-On / Off',
    icon: Radar,
    moduleKeys: ['regime'],
    links: [
      { label: 'Regime detail', href: '/regime' },
    ],
  },
  {
    key: 'liquidity',
    title: 'Liquidity & Capital Flows',
    subtitle: 'Stablecoin · Whale · Exchange flows',
    icon: Waves,
    moduleKeys: ['smartMoney', 'whaleFlow'],
    links: [
      { label: 'Stablecoin Liquidity', href: '/intelligence/stablecoin-liquidity' },
      { label: 'Whale Flows',          href: '/intelligence/whale-flows'          },
      { label: 'Exchange Flows',       href: '/intelligence/exchange-flows'       },
      { label: 'Smart Money',          href: '/intelligence/smart-money'          },
    ],
  },
  {
    key: 'sentiment',
    title: 'Sentiment Engine',
    subtitle: 'Narrative · Attention · Participation',
    icon: MessagesSquare,
    moduleKeys: [],
    links: [
      { label: 'Narrative',     href: '/intelligence/narrative'     },
      { label: 'Attention',     href: '/intelligence/attention'     },
      { label: 'Participation', href: '/intelligence/participation' },
    ],
  },
  {
    key: 'rotation',
    title: 'Rotation Engine',
    subtitle: 'Dominance · Sectors · Breadth · Rotation',
    icon: Repeat,
    moduleKeys: ['dominance', 'breadth'],
    links: [
      { label: 'Dominance & Rotation', href: '/intelligence/dominance'        },
      { label: 'Sector Intelligence',  href: '/intelligence/sectors'          },
      { label: 'Market Breadth',       href: '/intelligence/breadth'          },
      { label: 'Market Rotation',      href: '/intelligence/market-rotation'  },
      { label: 'On-Chain Heatmap',     href: '/intelligence/heatmap'          },
    ],
  },
  {
    key: 'momentum',
    title: 'Momentum Engine',
    subtitle: 'Conviction · Positioning · Phase · Tokens',
    icon: Rocket,
    moduleKeys: ['momentum'],
    links: [
      { label: 'Conviction',      href: '/intelligence/conviction'     },
      { label: 'Momentum Phase',  href: '/intelligence/momentum'       },
      { label: 'Positioning',     href: '/intelligence/positioning'    },
      { label: 'Token Momentum',  href: '/intelligence/token-momentum' },
    ],
  },
  {
    key: 'volatility',
    title: 'Volatility & Stress',
    subtitle: 'ATR · Stress · Correlations · Execution',
    icon: Activity,
    moduleKeys: ['volatility', 'correlation', 'execution'],
    links: [
      { label: 'Volatility',    href: '/intelligence/volatility'   },
      { label: 'Market Stress', href: '/intelligence/stress'       },
      { label: 'Correlations',  href: '/intelligence/correlations' },
    ],
  },
]

const KNOWN_MODULE_KEYS = new Set(SECTIONS.flatMap((s) => s.moduleKeys))

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

  // Index live modules by key for O(1) section lookup.
  const moduleByKey = useMemo(() => {
    const m = new Map<string, IntelligenceModule>()
    for (const mod of data?.modules ?? []) m.set(mod.key, mod)
    return m
  }, [data])

  // Catch-all bucket so a future engine never silently disappears.
  const orphans = useMemo(
    () => (data?.modules ?? []).filter((m) => !KNOWN_MODULE_KEYS.has(m.key)),
    [data],
  )

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      {/* Header */}
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Market <span className="text-gradient">Intelligence</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Consolidated decision surface — regime, flows, sentiment, rotation, momentum, and stress in one pass.
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

      {/* Market Pulse — verdict banner */}
      {data && <VerdictBanner data={data} />}

      {/* Sectioned grid */}
      {loading ? (
        <SkeletonSections />
      ) : data ? (
        <div className="space-y-5">
          {SECTIONS.map((section) => {
            const modules = section.moduleKeys
              .map((k) => moduleByKey.get(k))
              .filter((m): m is IntelligenceModule => Boolean(m))
            return (
              <SectionBlock
                key={section.key}
                section={section}
                modules={modules}
                changed={changed}
                onExpand={setSelected}
              />
            )
          })}

          {orphans.length > 0 && (
            <SectionBlock
              section={{
                key: 'other',
                title: 'Other engines',
                subtitle: 'Live signals not yet grouped',
                icon: Activity,
                moduleKeys: orphans.map((m) => m.key),
                links: [],
              }}
              modules={orphans}
              changed={changed}
              onExpand={setSelected}
            />
          )}
        </div>
      ) : null}

      <ExpandDrawer module={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function SectionBlock({
  section, modules, changed, onExpand,
}: {
  section: Section
  modules: IntelligenceModule[]
  changed: Set<string>
  onExpand: (m: IntelligenceModule) => void
}) {
  const Icon = section.icon
  const hasModules = modules.length > 0
  const hasLinks   = section.links.length > 0
  // Skip an empty section entirely — better than a hollow header.
  if (!hasModules && !hasLinks) return null

  return (
    <section className="surface p-4 sm:p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
          <h2 className="text-sm font-semibold">{section.title}</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">{section.subtitle}</span>
      </header>

      {hasModules && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <IntelligenceCard
              key={m.key} module={m}
              changed={changed.has(m.key)}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}

      {hasLinks && (
        <div className={cn(
          'flex flex-wrap items-center gap-2',
          hasModules && 'mt-3 border-t border-border/40 pt-3',
        )}>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Deep dives
          </span>
          {section.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-[11px] font-medium text-foreground/85 transition hover:border-amber-500/40 hover:bg-amber-500/[0.06] hover:text-amber-200"
            >
              {l.label}<ArrowRight className="h-2.5 w-2.5 opacity-60" strokeWidth={2.5} />
            </a>
          ))}
        </div>
      )}
    </section>
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

function SkeletonSections() {
  return (
    <div className="space-y-5">
      {SECTIONS.map((s) => (
        <div key={s.key} className="surface p-4 sm:p-5">
          <div className="mb-3 h-4 w-44 animate-pulse rounded bg-muted/40" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: Math.max(s.moduleKeys.length, 1) }).map((_, i) => (
              <div key={i} className="h-[132px] animate-pulse rounded-xl border border-border/60 bg-card/60" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
