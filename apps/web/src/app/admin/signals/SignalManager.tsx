'use client'

import { useState } from 'react'
import type { Strategy } from '@/lib/types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS, canTransition, TERMINAL_STATES } from '@/lib/signals/lifecycle'
import type { SignalLifecycleState } from '@/lib/types'
import { cn, formatDate } from '@/lib/utils'
import CreateSignalForm from './CreateSignalForm'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySignal = Record<string, any>

interface Props {
  initialSignals: AnySignal[]
  strategies: Strategy[]
}

export default function SignalManager({ initialSignals, strategies }: Props) {
  const [signals, setSignals] = useState<AnySignal[]>(initialSignals)
  const [showCreate, setShowCreate] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  function handleCreated(signal: AnySignal) {
    setSignals(prev => [signal, ...prev])
    setShowCreate(false)
  }

  async function handleLifecycle(id: string, newState: SignalLifecycleState, pips?: number) {
    setUpdating(id)
    const res = await fetch(`/api/admin/signals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lifecycle_state: newState, pips_gained: pips }),
    })
    if (res.ok) {
      const { data } = await res.json()
      setSignals(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
    }
    setUpdating(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this signal permanently?')) return
    const res = await fetch(`/api/admin/signals/${id}`, { method: 'DELETE' })
    if (res.ok) setSignals(prev => prev.filter(s => s.id !== id))
  }

  const filtered = filter === 'all' ? signals : signals.filter(s => s.lifecycle_state === filter)
  const active = signals.filter(s => s.lifecycle_state === 'active').length

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {['all', 'active', 'tp1_hit', 'stopped', 'expired'].map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize',
                filter === f ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'all' ? `All (${signals.length})` : `${LIFECYCLE_LABELS[f as SignalLifecycleState]} (${signals.filter(s => s.lifecycle_state === f).length})`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5">
            {active} live
          </span>
          <button
            type="button"
            onClick={() => setShowCreate(v => !v)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {showCreate ? '✕ Cancel' : '+ Publish Signal'}
          </button>
        </div>
      </div>

      {/* Creation form */}
      {showCreate && (
        <CreateSignalForm strategies={strategies} onCreated={handleCreated} />
      )}

      {/* Signal rows */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No signals in this category.
          </div>
        )}
        {filtered.map(signal => (
          <SignalRow
            key={signal.id}
            signal={signal}
            updating={updating === signal.id}
            onLifecycle={handleLifecycle}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  )
}

function SignalRow({
  signal, updating, onLifecycle, onDelete,
}: {
  signal: AnySignal
  updating: boolean
  onLifecycle: (id: string, state: SignalLifecycleState, pips?: number) => void
  onDelete: (id: string) => void
}) {
  const [pipsInput, setPipsInput] = useState('')
  const state = signal.lifecycle_state as SignalLifecycleState
  const isTerminal = (TERMINAL_STATES as string[]).includes(state)

  const nextStates = (['tp1_hit','tp2_hit','tp3_hit','stopped','breakeven','invalidated'] as SignalLifecycleState[])
    .filter(s => canTransition(state, s))

  const isBuy = signal.direction === 'buy'

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border bg-muted/20">
        <span className="font-bold text-base">{signal.pair}</span>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold uppercase', isBuy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
          {signal.direction}
        </span>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', LIFECYCLE_COLORS[state] ?? '')}>
          {LIFECYCLE_LABELS[state] ?? state}
        </span>
        {signal.quality_score != null && (
          <span className="text-xs text-muted-foreground">Q: {signal.quality_score}/10</span>
        )}
        {signal.confidence_score != null && (
          <span className="text-xs text-muted-foreground">Conf: {signal.confidence_score}%</span>
        )}
        {signal.strategy?.display_name && (
          <span className="text-xs text-muted-foreground hidden sm:inline">{signal.strategy.display_name}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{formatDate(signal.published_at)}</span>
      </div>

      <div className="px-5 py-3 grid grid-cols-3 sm:grid-cols-6 gap-3 text-sm">
        <Pip label="Entry" value={signal.entry_price} />
        <Pip label="SL" value={signal.stop_loss} color="text-red-600" />
        <Pip label="TP1" value={signal.take_profit_1} color="text-green-600" />
        <Pip label="TP2" value={signal.take_profit_2} color="text-green-600" />
        <Pip label="R:R" value={signal.risk_reward ? `1:${signal.risk_reward}` : '—'} />
        <Pip label="Tier" value={signal.tier_required} />
      </div>

      {!isTerminal && (
        <div className="px-5 pb-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            type="number"
            placeholder="Pips (optional)"
            value={pipsInput}
            onChange={e => setPipsInput(e.target.value)}
            className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {nextStates.map(s => (
            <button
              key={s}
              type="button"
              disabled={updating}
              onClick={() => onLifecycle(signal.id, s, pipsInput ? parseFloat(pipsInput) : undefined)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
                s === 'stopped' || s === 'invalidated' ? 'bg-red-600 text-white hover:bg-red-700' :
                s === 'breakeven' ? 'bg-yellow-500 text-black hover:bg-yellow-600' :
                'bg-green-600 text-white hover:bg-green-700'
              )}
            >
              {updating ? '…' : `→ ${LIFECYCLE_LABELS[s]}`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onDelete(signal.id)}
            className="ml-auto text-xs text-muted-foreground hover:text-destructive"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function Pip({ label, value, color }: { label: string; value: string | number | null | undefined; color?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-semibold', color)}>{value ?? '—'}</p>
    </div>
  )
}
