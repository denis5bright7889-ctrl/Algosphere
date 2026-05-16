'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import {
  effectivePrice,
  type PublishedStrategy,
  type StrategySubscription,
  type SubscriptionPlan,
  type CopyMode,
} from '@/lib/strategies'

interface Props {
  strategy:             PublishedStrategy
  existingSubscription: StrategySubscription | null
}

const PLAN_OPTIONS: { key: SubscriptionPlan; label: string; discount?: string }[] = [
  { key: 'monthly', label: 'Monthly'                    },
  { key: 'annual',  label: 'Annual', discount: 'Save 20%' },
  { key: 'lifetime', label: 'Lifetime'                  },
]

export default function SubscribeStrategyCard({
  strategy: s,
  existingSubscription,
}: Props) {
  const [plan, setPlan] = useState<SubscriptionPlan>('monthly')
  const [copyEnabled, setCopyEnabled] = useState(
    existingSubscription?.copy_enabled ?? false
  )
  const [copyMode, setCopyMode] = useState<CopyMode>(
    existingSubscription?.copy_mode ?? 'signal_only'
  )
  const [allocation, setAllocation] = useState(
    existingSubscription?.allocation_pct ?? 5
  )
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const price = effectivePrice(s, plan)
  const isSubscribed = existingSubscription?.status === 'active'

  function subscribe() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/social/subscriptions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            strategy_id:    s.id,
            plan,
            copy_enabled:   copyEnabled,
            copy_mode:      copyMode,
            allocation_pct: allocation,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed')

        if (data.requires_payment) {
          // Redirect to crypto payment flow
          window.location.href = data.payment_url
        } else {
          setSuccess('Subscribed! Signals will start arriving in your feed.')
          setTimeout(() => window.location.reload(), 1500)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  function updateSettings() {
    if (!existingSubscription) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/subscriptions/${existingSubscription.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            copy_enabled:   copyEnabled,
            copy_mode:      copyMode,
            allocation_pct: allocation,
          }),
        })
        if (!res.ok) throw new Error('Update failed')
        setSuccess('Settings updated.')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  function cancel() {
    if (!existingSubscription) return
    if (!confirm('Cancel this subscription? You\'ll keep access until the period ends.')) return

    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/subscriptions/${existingSubscription.id}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('Failed')
        window.location.reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sticky top-20">
      <h3 className="text-sm font-bold mb-1">
        {isSubscribed ? '✓ Subscribed' : 'Subscribe to this strategy'}
      </h3>

      {!isSubscribed && (
        <>
          {/* Plan selector */}
          <div className="space-y-1.5 mt-3 mb-4">
            {PLAN_OPTIONS.map(opt => {
              const optPrice = effectivePrice(s, opt.key)
              if (optPrice === 0 && !s.is_free) return null
              return (
                <label
                  key={opt.key}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                    plan === opt.key
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-border hover:border-border/80',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="plan"
                      value={opt.key}
                      checked={plan === opt.key}
                      onChange={() => setPlan(opt.key)}
                      className="accent-amber-400"
                    />
                    <span className="text-sm font-medium">{opt.label}</span>
                    {opt.discount && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                        {opt.discount}
                      </span>
                    )}
                  </span>
                  <span className="font-bold tabular-nums text-sm">
                    {s.is_free ? 'Free' : `$${optPrice}`}
                  </span>
                </label>
              )
            })}
          </div>
        </>
      )}

      {/* Copy trade settings */}
      {s.copy_enabled && (
        <div className="space-y-3 border-t border-border/50 pt-4 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={copyEnabled}
              onChange={e => setCopyEnabled(e.target.checked)}
              className="accent-amber-400"
            />
            <span className="font-medium">Auto-copy signals</span>
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:border-amber-500/40"
                >
                  <option value="signal_only">Signal alerts only</option>
                  <option value="semi_auto">Semi-auto (1-tap confirm)</option>
                  <option value="full_auto">Full auto (VIP only)</option>
                </select>
              </div>

              <div>
                <label className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
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
                  aria-label="Allocation per signal"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  % of your account equity at risk per copied trade.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {error   && <p className="text-xs text-rose-400 mb-2">{error}</p>}
      {success && <p className="text-xs text-emerald-400 mb-2">{success}</p>}

      {isSubscribed ? (
        <>
          <button
            type="button"
            onClick={updateSettings}
            disabled={pending}
            className={cn(
              'btn-premium w-full !text-xs !py-2.5 mb-2',
              pending && 'opacity-60 cursor-wait',
            )}
          >
            {pending ? 'Saving…' : 'Save Settings'}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="w-full rounded-lg border border-rose-500/40 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            Cancel Subscription
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={subscribe}
          disabled={pending}
          className={cn(
            'btn-premium w-full !text-sm !py-2.5',
            pending && 'opacity-60 cursor-wait',
          )}
        >
          {pending
            ? 'Processing…'
            : s.is_free
              ? 'Subscribe (Free)'
              : `Subscribe — $${price}`}
        </button>
      )}

      <p className="text-[10px] text-muted-foreground mt-3 text-center">
        70% goes to creator. 30% platform fee. {s.copy_enabled && `${s.profit_share_pct}% profit share on copied trades.`}
      </p>
    </div>
  )
}
