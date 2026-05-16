'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import type { PublishedStrategy } from '@/lib/strategies'

export default function EditStrategyForm({ strategy }: { strategy: PublishedStrategy }) {
  const [name, setName]         = useState(strategy.name)
  const [tagline, setTagline]   = useState(strategy.tagline ?? '')
  const [description, setDesc]  = useState(strategy.description ?? '')
  const [isFree, setIsFree]     = useState(strategy.is_free)
  const [priceMonthly, setPrice] = useState(strategy.price_monthly ?? 29)
  const [copyEnabled, setCopyEnabled] = useState(strategy.copy_enabled)
  const [profitShare, setProfitShare] = useState(strategy.profit_share_pct)
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function save() {
    setError(null)
    setSuccess(false)
    if (name.length < 3) return setError('Name too short')

    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/strategies/${strategy.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name,
            tagline,
            description,
            is_free:          isFree,
            price_monthly:    isFree ? null : priceMonthly,
            copy_enabled:     copyEnabled,
            profit_share_pct: profitShare,
          }),
        })
        if (!res.ok) {
          const e = await res.json()
          throw new Error(e.error ?? 'Failed')
        }
        setSuccess(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  function archive() {
    if (!confirm('Archive this strategy? Existing subscribers keep access but no new subs.')) return
    startTransition(async () => {
      try {
        const res = await fetch(`/api/social/strategies/${strategy.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed')
        window.location.href = '/dashboard/strategies?scope=mine'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
          />
        </Field>

        <Field label="Tagline">
          <input
            type="text"
            value={tagline}
            onChange={e => setTagline(e.target.value)}
            maxLength={120}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDesc(e.target.value)}
            rows={5}
            maxLength={2000}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
          />
        </Field>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isFree}
            onChange={e => setIsFree(e.target.checked)}
            className="accent-amber-400"
          />
          <span className="text-sm font-medium">Free strategy</span>
        </label>

        {!isFree && (
          <Field label="Monthly Price (USD)">
            <input
              type="number"
              min={1}
              value={priceMonthly}
              onChange={e => setPrice(parseFloat(e.target.value) || 0)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              You receive ${(priceMonthly * 0.7).toFixed(2)} per subscriber
            </p>
          </Field>
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={copyEnabled}
            onChange={e => setCopyEnabled(e.target.checked)}
            className="accent-amber-400"
          />
          <span className="text-sm font-medium">Copy trading enabled</span>
        </label>

        {copyEnabled && (
          <Field label={`Profit Share — ${profitShare}%`}>
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              value={profitShare}
              onChange={e => setProfitShare(parseInt(e.target.value, 10))}
              className="w-full accent-amber-400"
              aria-label="Profit share"
            />
          </Field>
        )}
      </div>

      {error   && <p className="text-xs text-rose-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">✓ Saved successfully</p>}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={archive}
          className="rounded-lg border border-rose-500/40 px-4 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          Archive Strategy
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className={cn(
            'btn-premium !text-sm !py-2 !px-6',
            pending && 'opacity-60 cursor-wait',
          )}
        >
          {pending ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}
