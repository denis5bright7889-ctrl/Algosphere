'use client'

import { Fragment, useState } from 'react'
import { X, Brain, AlertOctagon, Zap, Plug, Cpu, Landmark, Hand } from 'lucide-react'
import type { JournalEntry } from '@/lib/types'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import AddTradeModal from './AddTradeModal'

/** Journal entries on the wire carry a few columns beyond the shared
 *  JournalEntry type (source / broker came in via the auto-detection
 *  migration). V4 split the 'auto' source into auto_human (broker
 *  imported a human-clicked trade) and auto_engine (the AlgoSphere
 *  engine executed). 'auto' is kept here for backwards compatibility
 *  with pre-migration rows still cached client-side. */
type EntrySource = 'manual' | 'auto' | 'auto_human' | 'auto_engine'
type EntryWire = JournalEntry & {
  source?: EntrySource | null
  broker?: string | null
  engine_strategy_name?: string | null
}

/** Compact view of the latest coach evaluation for one journal entry.
 *  Surfaced server-side by /journal page.tsx so the client doesn't
 *  fan out a query per row.
 *
 *  V3: the 5 process sub-grades + ai_insights array are part of the
 *  shape so the strip can render them inline. All nullable for
 *  backward-compat with pre-V3 evaluation rows. */
export interface CoachEvalSummary {
  quality_score:    number
  strategy_grade:   'A' | 'B' | 'C' | 'D' | 'F'
  emotional_flag:   boolean
  emotional_reason: string | null
  advancement:      string | null
  top_fix:          string | null
  execution_grade?:  number | null
  psychology_grade?: number | null
  risk_grade?:       number | null
  discipline_grade?: number | null
  timing_grade?:     number | null
  ai_insights?:      string[]
}

interface Props {
  initialEntries: JournalEntry[]
  userId: string
  coachByEntry?: Record<string, CoachEvalSummary>
  /** Number of broker_connections with status='connected'. Drives the
   *  auto-fill status banner (active vs eligible vs not connected). */
  connectedBrokerCount?: number
  /** How many of the current entries came from the auto-fill pipeline. */
  autoEntryCount?: number
}

export default function JournalClient({
  initialEntries, userId, coachByEntry = {},
  connectedBrokerCount = 0, autoEntryCount = 0,
}: Props) {
  const [entries, setEntries] = useState<EntryWire[]>(initialEntries as EntryWire[])
  const [showModal, setShowModal] = useState(false)

  const totalPnl = entries.reduce((s, e) => s + (e.pnl ?? 0), 0)
  const wins = entries.filter((e) => (e.pnl ?? 0) > 0).length
  const losses = entries.filter((e) => (e.pnl ?? 0) < 0).length
  const winRate = entries.length ? Math.round((wins / entries.length) * 100) : 0

  function handleAdded(entry: JournalEntry) {
    setEntries((prev) => [entry as EntryWire, ...prev])
    setShowModal(false)
  }

  async function handleDelete(id: string) {
    // Mobile-safety: never delete on a stray tap
    if (typeof window !== 'undefined' && !window.confirm('Delete this trade?')) return
    const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' })
    if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Trade Journal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {entries.length} trade{entries.length !== 1 ? 's' : ''} logged
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="min-h-[44px] rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 touch-manipulation"
        >
          + Add trade
        </button>
      </div>

      {/* Auto-fill status — bridges connected brokers to the journal */}
      <AutoFillBanner
        connectedBrokers={connectedBrokerCount}
        autoEntries={autoEntryCount}
      />

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total P&L', value: formatCurrency(totalPnl), color: totalPnl >= 0 ? 'text-green-600' : 'text-red-600' },
          { label: 'Win Rate', value: `${winRate}%`, color: '' },
          { label: 'Wins', value: String(wins), color: 'text-green-600' },
          { label: 'Losses', value: String(losses), color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('mt-1 text-xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table (desktop) / card list (mobile) */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">No trades yet. Log your first trade!</p>
        </div>
      ) : (
        <>
        {/* Mobile card view */}
        <ul className="space-y-3 md:hidden">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold truncate">{e.pair ?? '—'}</span>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      e.direction === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    )}>
                      {e.direction ?? '—'}
                    </span>
                    {e.setup_tag && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize">
                        {e.setup_tag}
                      </span>
                    )}
                    <SourceBadge source={e.source} broker={e.broker} strategy={e.engine_strategy_name} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {e.trade_date ? formatDate(e.trade_date) : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Delete trade"
                  onClick={() => handleDelete(e.id)}
                  className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive active:bg-accent touch-manipulation"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Entry</p>
                  <p className="font-medium tabular-nums">{e.entry_price ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Exit</p>
                  <p className="font-medium tabular-nums">{e.exit_price ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lots</p>
                  <p className="font-medium tabular-nums">{e.lot_size ?? '—'}</p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                <div className="text-[11px]">
                  <span className="text-muted-foreground">Pips:</span>{' '}
                  {e.pips != null ? (
                    <span className={cn('font-semibold tabular-nums', e.pips >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {e.pips >= 0 ? '+' : ''}{e.pips}
                    </span>
                  ) : '—'}
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {e.pnl != null ? (
                    <span className={e.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {formatCurrency(e.pnl)}
                    </span>
                  ) : '—'}
                </div>
              </div>

              {/* Refocus R4b: AI coach evaluation for this trade, if persisted */}
              {coachByEntry[e.id] && <CoachStrip eval={coachByEntry[e.id]!} />}
            </li>
          ))}
        </ul>

        {/* Desktop table view */}
        <div className="hidden md:block rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {['Date', 'Pair', 'Dir', 'Entry', 'Exit', 'Lots', 'Pips', 'P&L', 'Setup', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const coach = coachByEntry[e.id]
                return (
                  <Fragment key={e.id}>
                    <tr
                      className={cn(
                        'border-b border-border hover:bg-muted/30',
                        coach && 'border-b-0',
                      )}
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {e.trade_date ? formatDate(e.trade_date) : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {e.pair ?? '—'}
                          <SourceBadge source={e.source} broker={e.broker} strategy={e.engine_strategy_name} />
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-semibold uppercase',
                          e.direction === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        )}>
                          {e.direction ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">{e.entry_price ?? '—'}</td>
                      <td className="px-4 py-3">{e.exit_price ?? '—'}</td>
                      <td className="px-4 py-3">{e.lot_size ?? '—'}</td>
                      <td className="px-4 py-3">
                        {e.pips != null ? (
                          <span className={e.pips >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {e.pips >= 0 ? '+' : ''}{e.pips}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {e.pnl != null ? (
                          <span className={e.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {formatCurrency(e.pnl)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {e.setup_tag ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                            {e.setup_tag}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          aria-label="Delete trade"
                          onClick={() => handleDelete(e.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-destructive touch-manipulation"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {coach && (
                      <tr className="border-b border-border last:border-0">
                        <td colSpan={10} className="px-4 pb-3 pt-0">
                          <CoachStrip eval={coach} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {showModal && (
        <AddTradeModal
          userId={userId}
          onAdded={handleAdded}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}

const GRADE_STYLES: Record<CoachEvalSummary['strategy_grade'], string> = {
  A: 'bg-green-100 text-green-800 ring-green-300',
  B: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  C: 'bg-amber-50 text-amber-700 ring-amber-200',
  D: 'bg-orange-50 text-orange-700 ring-orange-200',
  F: 'bg-red-100 text-red-800 ring-red-300',
}

/** V4 source badge — three states, three meanings:
 *    MANUAL   (gray)    — user typed the trade by hand
 *    BROKER   (amber)   — broker imported a human-clicked trade
 *                         (source='auto_human' or legacy 'auto')
 *    ENGINE   (emerald) — AlgoSphere engine published + executed
 *                         (source='auto_engine'); the engine explains
 *                         itself, so psychology is N/A
 *  Manual rows render no badge so the journal stays scannable. */
function SourceBadge({ source, broker, strategy }: {
  source?: EntrySource | null
  broker?: string | null
  strategy?: string | null
}) {
  if (!source || source === 'manual') return null

  if (source === 'auto_engine') {
    return (
      <span
        title={strategy
          ? `Auto-executed by the engine — strategy: ${strategy}`
          : 'Auto-executed by the AlgoSphere engine'}
        className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300"
      >
        <Cpu className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
        Engine
      </span>
    )
  }

  // 'auto_human' OR legacy 'auto'
  return (
    <span
      title={broker
        ? `Auto-imported from ${broker.toUpperCase()} (human-clicked)`
        : 'Auto-imported from a connected broker (human-clicked)'}
      className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300"
    >
      <Landmark className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
      Broker
    </span>
  )
}

// Hand is retained for a future per-row "human-clicked" indicator
// (Phase 2 of the V4 work). Zap and Plug are used by the AutoFillBanner.
void Hand

/** Top-of-page status strip explaining how auto-fill works. Three states:
 *  - At least one auto entry exists → "active" (green)
 *  - Broker connected but no auto entries yet → "eligible" (amber, hint)
 *  - No broker connected → "available" (muted, CTA to /brokers) */
function AutoFillBanner({
  connectedBrokers, autoEntries,
}: {
  connectedBrokers: number
  autoEntries: number
}) {
  if (autoEntries > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] px-3.5 py-2.5 text-[12px] text-emerald-200">
        <Zap className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="font-semibold">Auto-fill is active.</span>{' '}
          {autoEntries} trade{autoEntries === 1 ? '' : 's'} imported from your connected
          broker{connectedBrokers > 1 ? 's' : ''}. Rows tagged{' '}
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">Auto</span>{' '}
          came from the live execution feed.
        </span>
        <a href="/brokers" className="shrink-0 text-[11px] font-semibold text-amber-300 hover:underline">
          Manage brokers
        </a>
      </div>
    )
  }
  if (connectedBrokers > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.05] px-3.5 py-2.5 text-[12px] text-amber-200">
        <Zap className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="font-semibold">Auto-fill is ready.</span>{' '}
          {connectedBrokers} broker{connectedBrokers > 1 ? 's' : ''} connected. The next
          live trade from that account will appear here automatically — no manual entry needed.
        </span>
        <a href="/brokers" className="shrink-0 text-[11px] font-semibold text-amber-300 hover:underline">
          Brokers
        </a>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12px] text-muted-foreground">
      <Plug className="h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2} aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="font-semibold text-foreground">Tip:</span> connect a broker and
        your trades log here automatically — no more typing entries by hand.
      </span>
      <a href="/brokers" className="shrink-0 text-[11px] font-semibold text-amber-300 hover:underline">
        Connect broker
      </a>
    </div>
  )
}

/** V3 sub-grade tones — process-based, never PnL-based. */
function subGradeTone(score: number | null | undefined): string {
  if (score == null) return 'text-muted-foreground/60'
  if (score >= 80) return 'text-emerald-300'
  if (score >= 65) return 'text-emerald-200'
  if (score >= 50) return 'text-amber-300'
  if (score >= 35) return 'text-orange-300'
  return 'text-rose-300'
}

/** Inline coach strip — renders the overall grade + the 5 process
 *  sub-grades (Execution / Psychology / Risk / Discipline / Timing) +
 *  the lead AI insight if any. Process-based, never PnL-based. */
function CoachStrip({ eval: ev }: { eval: CoachEvalSummary }) {
  const gradeCls = GRADE_STYLES[ev.strategy_grade] ?? GRADE_STYLES.C
  const hasSubGrades =
    ev.execution_grade  != null || ev.psychology_grade != null ||
    ev.risk_grade       != null || ev.discipline_grade != null ||
    ev.timing_grade     != null
  const leadInsight = ev.ai_insights?.[0] ?? ev.advancement ?? null

  return (
    <div className="mt-2 rounded-md bg-muted/40 px-2.5 py-2 text-[11px] md:mt-0">
      {/* Row 1: overall grade + sub-grade tile strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
          <Brain className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          Coach
        </span>
        <span
          className={cn(
            'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1.5 text-[10px] font-bold ring-1',
            gradeCls,
          )}
          title={`Overall ${ev.strategy_grade} · ${ev.quality_score}/100 — process-based, not PnL-based`}
        >
          {ev.strategy_grade}
        </span>
        <span className="text-muted-foreground tabular-nums">{ev.quality_score}/100</span>
        {ev.emotional_flag && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-700 ring-1 ring-red-200"
            title={ev.emotional_reason ?? 'Emotional pattern detected'}
          >
            <AlertOctagon className="h-3 w-3" strokeWidth={2} aria-hidden />
            Emotional
          </span>
        )}
        {hasSubGrades && (
          <span className="ml-auto inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground/80">
            <SubGrade label="Exec" score={ev.execution_grade}  />
            <SubGrade label="Psy"  score={ev.psychology_grade} />
            <SubGrade label="Risk" score={ev.risk_grade}       />
            <SubGrade label="Disc" score={ev.discipline_grade} />
            <SubGrade label="Time" score={ev.timing_grade}     />
          </span>
        )}
      </div>

      {/* Row 2: lead insight (preferring AI insights over advancement). */}
      {leadInsight && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80 line-clamp-2">
          {leadInsight}
        </p>
      )}

      {/* Row 3: remaining insights (when present), tiny chips. */}
      {ev.ai_insights && ev.ai_insights.length > 1 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {ev.ai_insights.slice(1, 3).map((i, idx) => (
            <li
              key={idx}
              className="rounded-full border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={i}
            >
              {i.length > 80 ? `${i.slice(0, 78)}…` : i}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SubGrade({ label, score }: { label: string; score?: number | null }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`${label} grade ${score ?? '—'}/100 — process-based`}
    >
      <span className="font-semibold text-muted-foreground/70">{label}</span>
      <span className={cn('font-bold tabular-nums', subGradeTone(score))}>
        {score ?? '—'}
      </span>
    </span>
  )
}
