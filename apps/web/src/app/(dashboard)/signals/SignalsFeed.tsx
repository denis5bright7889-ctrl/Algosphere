'use client'

import {
  Activity, AlertTriangle, CheckCircle2, Pause, Radar,
} from 'lucide-react'
import { useRealtimeSignals } from '@/hooks/useRealtimeSignals'
import SignalCard from '@/components/dashboard/SignalCard'
import type { Signal, SubscriptionTier } from '@/lib/types'
import { cn, formatRelativeTime } from '@/lib/utils'

/** Engine snapshot piped from the server. Used to explain WHY the feed
 *  is empty when it's empty, instead of a generic "no signals" box. */
export type EngineSnapshot = {
  ok:           boolean
  enabled:      boolean | null
  provider:     string | null
  symbols:      string[] | null
  lastTick:     string | null
  error:        string | null
  lastSignalAt: string | null
} | null

interface Props {
  initialSignals: Signal[]
  userTier:       SubscriptionTier
  userEmail:      string
  isAdmin:        boolean
  engine?:        EngineSnapshot
}

export default function SignalsFeed({ initialSignals, userTier, userEmail, isAdmin, engine }: Props) {
  const { signals, connected } = useRealtimeSignals(initialSignals)
  const active  = signals.filter(s => s.lifecycle_state === 'active' || s.status === 'active')
  const history = signals.filter(s => s.lifecycle_state !== 'active' && s.status !== 'active')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Intelligence Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {active.length} active signal{active.length !== 1 ? 's' : ''}
            {engine?.lastSignalAt && (
              <> · last signal {formatRelativeTime(engine.lastSignalAt)}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500')} />
            <span className="text-muted-foreground">{connected ? 'Live' : 'Connecting…'}</span>
          </div>
          {userTier === 'free' && !isAdmin && (
            <a href="/upgrade" className="min-h-[40px] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:px-4 touch-manipulation">
              Upgrade
            </a>
          )}
          {isAdmin && (
            <a href="/admin/signals" className="min-h-[40px] rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 sm:px-4 touch-manipulation">
              Manage <span className="hidden sm:inline">signals </span>→
            </a>
          )}
        </div>
      </div>

      {/* Engine pulse strip — always visible when we have a snapshot,
          so users see WHAT the engine is doing, not just whether the
          feed has signals. */}
      {engine && <EnginePulseStrip engine={engine} />}

      {active.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Active Opportunities
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map(signal => (
              <SignalCard key={signal.id} signal={signal} userTier={userTier} userEmail={userEmail} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Closed Positions
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {history.map(signal => (
              <SignalCard key={signal.id} signal={signal} userTier={userTier} userEmail={userEmail} />
            ))}
          </div>
        </section>
      )}

      {signals.length === 0 && <EmptyFeedState engine={engine} />}
    </div>
  )
}


// ─── Engine pulse strip ────────────────────────────────────────────

function EnginePulseStrip({ engine }: { engine: NonNullable<EngineSnapshot> }) {
  // Engine unreachable → rose. Enabled+running → emerald. Disabled → amber.
  if (!engine.ok) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span>
          <span className="font-semibold">Engine unreachable.</span>{' '}
          The signal-engine isn&apos;t responding ({engine.error}). The feed below shows the last known state; new signals will appear as soon as the engine reconnects.
        </span>
      </div>
    )
  }
  const enabled = engine.enabled === true
  const tone = enabled
    ? 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-200'
    : 'border-amber-500/40   bg-amber-500/[0.06]   text-amber-200'
  const Icon = enabled ? CheckCircle2 : Pause
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-[12px]', tone)}>
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        {enabled ? 'Engine active' : 'Engine paused'}
      </span>
      {engine.symbols && engine.symbols.length > 0 && (
        <span className="inline-flex items-center gap-1.5 opacity-90">
          <Radar className="h-3 w-3" strokeWidth={2} aria-hidden />
          Scanning {engine.symbols.length} symbols
        </span>
      )}
      {engine.lastTick && (
        <span className="inline-flex items-center gap-1.5 opacity-90">
          <Activity className="h-3 w-3" strokeWidth={2} aria-hidden />
          Last tick {formatRelativeTime(engine.lastTick)}
        </span>
      )}
    </div>
  )
}


// ─── Empty state with diagnostics ──────────────────────────────────

function EmptyFeedState({ engine }: { engine?: EngineSnapshot }) {
  // No engine snapshot at all → minimal generic state.
  if (!engine) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">No signals in the feed yet.</p>
      </div>
    )
  }
  // Engine unreachable was already shown in the pulse strip; the empty
  // box here just reinforces the wait.
  if (!engine.ok) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">No signals to show while the engine is unreachable.</p>
        <p className="mt-2 text-xs text-muted-foreground/80">
          Refresh in a minute — the connection probe runs every scan cycle.
        </p>
      </div>
    )
  }
  if (engine.enabled === false) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.04] p-12 text-center">
        <p className="text-amber-200 font-semibold">Engine is paused.</p>
        <p className="mt-2 text-xs text-amber-200/80 max-w-md mx-auto">
          Signal generation is intentionally off. The feed will resume publishing as soon as the engine is re-enabled.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <p className="text-foreground/85 font-semibold">Engine is running — no signals meet the confluence threshold right now.</p>
      <p className="mt-2 text-xs text-muted-foreground max-w-md mx-auto">
        AlgoSphere only publishes when confluence + risk gates align. Silence is honest, not a fault.{' '}
        {engine.lastSignalAt
          ? <>Last signal across the platform: <span className="font-mono text-foreground/85">{formatRelativeTime(engine.lastSignalAt)}</span>.</>
          : <>No signals have been published yet in the recent window.</>}
      </p>
    </div>
  )
}
