'use client'

/**
 * Decision Brain card — the single consolidated institutional decision.
 *
 * Displays ONLY decision states (permission, market/momentum/flow,
 * participation, confidence, risk, direction, horizon) + the short
 * institutional reasoning. NO raw indicators — by contract the brain
 * never returns ATR/entropy/whale logs/raw correlations.
 *
 * Fetches /api/intelligence/decision client-side so the landing renders
 * instantly and the verdict streams in with a skeleton.
 */
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { SkeletonText } from '@/components/ui/Skeleton'
import type { DecisionObject } from '@/lib/decision-brain/types'

type Decision = DecisionObject & { generated_at?: string }

export default function DecisionBrainCard() {
  const [d, setD] = useState<Decision | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch('/api/intelligence/decision', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<Decision> : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data) => { if (!cancelled) { setD(data); setState('ready') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  return (
    <section className={cn('rounded-2xl border bg-card p-5 shadow-sm',
      state === 'ready' && d ? permTone(d.trade_permission).border : 'border-border')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Decision Brain · consolidated read
        </h2>
        {d?.generated_at && state === 'ready' && (
          <span className="text-[10px] text-muted-foreground">Updated {new Date(d.generated_at).toLocaleTimeString()}</span>
        )}
      </div>

      {state === 'loading' && <SkeletonText lines={4} />}
      {state === 'error' && (
        <p className="text-sm text-muted-foreground">Decision read unavailable right now.</p>
      )}

      {state === 'ready' && d && (
        <>
          {/* Hero: the verdict */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn('rounded-lg border px-3 py-1 text-lg font-bold uppercase tracking-wider', permTone(d.trade_permission).pill)}>
                  {d.trade_permission}
                </span>
                <DirectionTag bias={d.direction_bias} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {marketLabel(d.market_state)} · {d.time_horizon === 'UNCERTAIN' ? 'horizon uncertain' : `${d.time_horizon.toLowerCase()} horizon`}
              </p>
            </div>
            <ConfidenceDial value={d.confidence} perm={d.trade_permission} />
          </div>

          {/* State chips */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Chip label="Market"        value={marketLabel(d.market_state)} />
            <Chip label="Momentum"      value={titleCase(d.momentum_state)} />
            <Chip label="Flow"          value={titleCase(d.flow_bias)} />
            <Chip label="Participation" value={titleCase(d.participation)} />
            <Chip label="Risk"          value={d.risk_level} tone={riskTone(d.risk_level)} />
          </div>

          {/* V3 Phase 7 — Recommended Exposure / Position Size / Aggressiveness.
              These translate the verdict into HOW MUCH and HOW HARD,
              not just WHETHER. Always rendered so the user can read the
              execution posture at a glance. */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 border-t border-border/50 pt-3">
            <Chip label="Recommended Exposure"  value={`${d.recommended_exposure}%`}        tone={exposureTone(d.recommended_exposure)} />
            <Chip label="Position Size"         value={d.suggested_position_size}            tone={sizeTone(d.suggested_position_size)} />
            <Chip label="Aggressiveness"        value={d.aggressiveness}                    tone={aggressivenessTone(d.aggressiveness)} />
          </div>

          {/* Institutional reasoning */}
          {d.explanation.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-border/50 pt-3">
              {d.explanation.map((line, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="text-muted-foreground/50">·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────

function ConfidenceDial({ value, perm }: { value: number; perm: DecisionObject['trade_permission'] }) {
  const tone = perm === 'ALLOW' ? 'text-emerald-400' : perm === 'REDUCE' ? 'text-amber-400' : 'text-rose-400'
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className={cn('text-3xl font-semibold tabular-nums leading-none', tone)}>{value}</span>
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">confidence</span>
    </div>
  )
}

function DirectionTag({ bias }: { bias: DecisionObject['direction_bias'] }) {
  if (bias === 'NEUTRAL') return <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Neutral</span>
  const up = bias === 'LONG'
  return (
    <span className={cn('rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider',
      up ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-rose-500/30 bg-rose-500/15 text-rose-300')}>
      {bias}
    </span>
  )
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold', tone ?? '')}>{value}</div>
    </div>
  )
}

function permTone(p: DecisionObject['trade_permission']): { pill: string; border: string } {
  switch (p) {
    case 'ALLOW':  return { pill: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300', border: 'border-emerald-500/30' }
    case 'REDUCE': return { pill: 'border-amber-500/40 bg-amber-500/15 text-amber-300',       border: 'border-amber-500/30' }
    default:       return { pill: 'border-rose-500/40 bg-rose-500/15 text-rose-300',           border: 'border-rose-500/30' }
  }
}
function riskTone(r: DecisionObject['risk_level']): string {
  return r === 'EXTREME' ? 'text-rose-400' : r === 'HIGH' ? 'text-amber-400' : r === 'MEDIUM' ? 'text-amber-300/80' : 'text-emerald-400'
}
function exposureTone(n: number): string {
  return n >= 70 ? 'text-emerald-400' : n >= 35 ? 'text-amber-300' : n > 0 ? 'text-amber-400' : 'text-rose-400'
}
function sizeTone(s: DecisionObject['suggested_position_size']): string {
  return s === 'Scaled' ? 'text-emerald-400'
    : s === 'Standard' ? 'text-sky-300'
    : s === 'Reduced' ? 'text-amber-300'
    :                   'text-rose-400'
}
function aggressivenessTone(a: DecisionObject['aggressiveness']): string {
  return a === 'Aggressive' ? 'text-emerald-400'
    : a === 'Active'      ? 'text-sky-300'
    : a === 'Measured'    ? 'text-amber-300'
    :                       'text-rose-400'
}
function marketLabel(s: DecisionObject['market_state']): string {
  return s === 'RISK_ON' ? 'Risk-On' : s === 'RISK_OFF' ? 'Risk-Off' : titleCase(s)
}
function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase()
}
