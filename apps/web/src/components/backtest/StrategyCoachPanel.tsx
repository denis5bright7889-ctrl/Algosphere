/**
 * StrategyCoachPanel — block-aware coach output rendered under the
 * existing StrategyDiagnostics on /backtest.
 *
 * Pure render layer. The hard logic lives in lib/intelligence/
 * strategy-coach.ts. This component only formats the actions.
 */
'use client'

import {
  Sparkles, AlertOctagon, AlertTriangle, Info, CheckCircle2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BacktestResult } from '@/lib/backtest'
import type { StrategyConfig } from '@/lib/strategies/blocks'
import {
  coachStrategy, type CoachAction, type CoachActionKind,
} from '@/lib/intelligence/strategy-coach'

interface Props {
  result:  BacktestResult
  /** When omitted, the coach only renders config-blind actions. */
  config?: StrategyConfig | null
}

export default function StrategyCoachPanel({ result, config }: Props) {
  const report = coachStrategy(result, config ?? null)
  if (!report.has_signal) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
        <h3 className="text-sm font-semibold">Coach recommendations</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {report.actions.length} action{report.actions.length === 1 ? '' : 's'}
        </span>
      </header>

      <ul className="space-y-2">
        {report.actions.map((a, i) => (
          <CoachRow key={`${a.kind}-${i}`} a={a} />
        ))}
      </ul>
    </div>
  )
}

function CoachRow({ a }: { a: CoachAction }) {
  const Icon = kindIcon(a.kind, a.severity)
  return (
    <li className={cn(
      'rounded-lg border p-3 flex gap-2.5 text-[12px]',
      a.severity === 'critical' && 'border-rose-500/40 bg-rose-500/[0.05]',
      a.severity === 'warn'     && 'border-amber-500/40 bg-amber-500/[0.04]',
      a.severity === 'info'     && 'border-border bg-background/40',
      a.severity === 'good'     && 'border-emerald-500/40 bg-emerald-500/[0.04]',
    )}>
      <Icon className={cn(
        'mt-0.5 h-4 w-4 shrink-0',
        a.severity === 'critical' && 'text-rose-300',
        a.severity === 'warn'     && 'text-amber-300',
        a.severity === 'info'     && 'text-muted-foreground',
        a.severity === 'good'     && 'text-emerald-300',
      )} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug">{a.title}</p>
        <p className="mt-1 text-foreground/80 leading-relaxed">{a.rationale}</p>
        {a.block_target && (
          <p className="mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[10.5px] font-mono text-muted-foreground">
            <span className="font-bold text-amber-300/90">Block</span>
            <span>→ {a.block_target.block_label}</span>
            {a.block_target.param_label && (
              <>
                <span className="opacity-50">·</span>
                <span>{a.block_target.param_label}</span>
              </>
            )}
            {a.block_target.current !== undefined && (
              <>
                <span className="opacity-50">·</span>
                <span>now: {String(a.block_target.current)}</span>
              </>
            )}
            {a.block_target.suggested !== undefined && (
              <>
                <span className="opacity-50">→</span>
                <span className="font-bold text-emerald-300">{String(a.block_target.suggested)}</span>
              </>
            )}
          </p>
        )}
      </div>
    </li>
  )
}

function kindIcon(_kind: CoachActionKind, severity: CoachAction['severity']): LucideIcon {
  if (severity === 'critical') return AlertOctagon
  if (severity === 'warn')     return AlertTriangle
  if (severity === 'good')     return CheckCircle2
  return Info
}
