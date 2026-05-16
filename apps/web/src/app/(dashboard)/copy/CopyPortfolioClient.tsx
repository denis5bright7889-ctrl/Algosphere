'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import type { CopyMode } from '@/lib/strategies'

interface Sub {
  id:              string
  strategy_id:     string
  plan:            string
  status:          string
  copy_enabled:    boolean
  copy_mode:       CopyMode
  allocation_pct:  number
  risk_multiplier: number
  max_lot_size:    number | null
  copy_sl:         boolean
  copy_tp:         boolean
  started_at:      string
  expires_at:      string | null
  published_strategies: {
    id:              string
    name:            string
    slug:            string
    win_rate:        number | null
    monthly_return_avg: number | null
    max_drawdown:    number | null
    sharpe_ratio:    number | null
    copy_enabled:    boolean
    profiles: { public_handle: string | null } | null
  } | null
}

interface Props {
  initialSubscriptions: Sub[]
  pnlBySub: Record<string, { total: number; count: number; wins: number }>
}

export default function CopyPortfolioClient({ initialSubscriptions, pnlBySub }: Props) {
  const [subs, setSubs] = useState<Sub[]>(initialSubscriptions)
  const [editing, setEditing] = useState<string | null>(null)

  function updateLocal(id: string, patch: Partial<Sub>) {
    setSubs(arr => arr.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  return (
    <div className="space-y-3">
      {subs.map(sub => {
        const pnl = pnlBySub[sub.id] ?? { total: 0, count: 0, wins: 0 }
        const isEditing = editing === sub.id
        return (
          <SubscriptionRow
            key={sub.id}
            sub={sub}
            pnl={pnl}
            isEditing={isEditing}
            onEdit={() => setEditing(isEditing ? null : sub.id)}
            onUpdate={(patch) => updateLocal(sub.id, patch)}
            onCancel={() => setSubs(arr => arr.filter(s => s.id !== sub.id))}
          />
        )
      })}
    </div>
  )
}

function SubscriptionRow({
  sub, pnl, isEditing, onEdit, onUpdate, onCancel,
}: {
  sub: Sub
  pnl: { total: number; count: number; wins: number }
  isEditing: boolean
  onEdit: () => void
  onUpdate: (patch: Partial<Sub>) => void
  onCancel: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [copyEnabled, setCopyEnabled] = useState(sub.copy_enabled)
  const [copyMode, setCopyMode]       = useState<CopyMode>(sub.copy_mode)
  const [allocation, setAllocation]   = useState(sub.allocation_pct)
  const [riskMult, setRiskMult]       = useState(sub.risk_multiplier)
  const [error, setError]             = useState<string | null>(null)

  const strategy = sub.published_strategies
  if (!strategy) return null
  const winRate = pnl.count > 0 ? (pnl.wins / pnl.count * 100) : null

  function save() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/subscriptions/${sub.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            copy_enabled:    copyEnabled,
            copy_mode:       copyMode,
            allocation_pct:  allocation,
            risk_multiplier: riskMult,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        onUpdate({
          copy_enabled: copyEnabled, copy_mode: copyMode,
          allocation_pct: allocation, risk_multiplier: riskMult,
        })
        onEdit()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  function cancelSub() {
    const name = strategy?.name ?? 'this strategy'
    if (!confirm(`Cancel subscription to "${name}"? You'll lose access at the end of the period.`)) return
    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/subscriptions/${sub.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed')
        onCancel()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="min-w-0">
            <a
              href={`/dashboard/strategies/${strategy.slug}`}
              className="text-base font-bold hover:text-amber-300 transition-colors"
            >
              {strategy.name}
            </a>
            {strategy.profiles?.public_handle && (
              <p className="text-[11px] text-muted-foreground">
                by{' '}
                <a
                  href={`/traders/${strategy.profiles.public_handle}`}
                  className="hover:text-amber-300"
                >
                  @{strategy.profiles.public_handle}
                </a>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize',
              sub.copy_enabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-border text-muted-foreground',
            )}>
              {sub.copy_enabled ? `Copying · ${sub.copy_mode.replace('_', ' ')}` : 'Signals only'}
            </span>
            <span className="rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] capitalize">
              {sub.plan}
            </span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs mb-3">
          <Stat
            label="My P&L"
            value={pnl.count > 0 ? `${pnl.total >= 0 ? '+' : ''}$${pnl.total.toFixed(2)}` : '—'}
            tone={pnl.total >= 0 ? 'green' : 'red'}
          />
          <Stat
            label="Copies"
            value={pnl.count.toString()}
          />
          <Stat
            label="My Win Rate"
            value={winRate != null ? `${winRate.toFixed(0)}%` : '—'}
          />
          <Stat
            label="Allocation"
            value={`${sub.allocation_pct}%`}
          />
          <Stat
            label="Risk Mult"
            value={`${sub.risk_multiplier}x`}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/30"
          >
            {isEditing ? 'Close' : 'Edit Settings'}
          </button>
          <a
            href={`/dashboard/strategies/${strategy.slug}`}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/30"
          >
            View Strategy
          </a>
          <button
            type="button"
            onClick={cancelSub}
            disabled={pending}
            className="ml-auto rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            Cancel Sub
          </button>
        </div>
      </div>

      {isEditing && strategy.copy_enabled && (
        <div className="border-t border-border/50 bg-background/30 p-5 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={copyEnabled}
              onChange={e => setCopyEnabled(e.target.checked)}
              className="accent-amber-400"
            />
            <span className="font-medium">Auto-copy signals from this strategy</span>
          </label>

          {copyEnabled && (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Copy Mode
                </label>
                <select
                  value={copyMode}
                  onChange={e => setCopyMode(e.target.value as CopyMode)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="signal_only">Signal alerts only</option>
                  <option value="semi_auto">Semi-auto (1-tap confirm)</option>
                  <option value="full_auto">Full auto (VIP only)</option>
                </select>
              </div>

              <div>
                <label className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  <span>Allocation per signal</span>
                  <span className="font-bold tabular-nums text-foreground">{allocation}%</span>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={allocation}
                  onChange={e => setAllocation(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                  aria-label="Allocation"
                />
              </div>

              <div>
                <label className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  <span>Risk Multiplier</span>
                  <span className="font-bold tabular-nums text-foreground">{riskMult.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={3}
                  step={0.1}
                  value={riskMult}
                  onChange={e => setRiskMult(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                  aria-label="Risk multiplier"
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium hover:bg-muted/30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className={cn(
                'btn-premium !text-xs !py-1.5 !px-4',
                pending && 'opacity-60 cursor-wait',
              )}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'red'
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-0.5 font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}
