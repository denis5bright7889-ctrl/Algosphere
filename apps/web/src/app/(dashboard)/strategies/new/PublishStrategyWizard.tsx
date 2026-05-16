'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

const ASSET_OPTIONS = ['forex','crypto','indices','commodities','metals'] as const
const TIMEFRAME_OPTIONS = ['M5','M15','M30','H1','H4','D1'] as const
const STYLE_OPTIONS = ['scalping','day','swing','position'] as const
const RISK_OPTIONS = ['conservative','moderate','aggressive'] as const
const COPY_OPTIONS = ['signal_only','semi_auto','full_auto'] as const

interface Draft {
  name:            string
  tagline:         string
  description:     string
  asset_classes:   string[]
  timeframes:      string[]
  trading_style?:  typeof STYLE_OPTIONS[number]
  risk_approach?:  typeof RISK_OPTIONS[number]
  is_free:         boolean
  price_monthly:   number
  price_annual:    number | undefined
  copy_enabled:    boolean
  copy_mode:       typeof COPY_OPTIONS[number]
  profit_share_pct: number
}

const initial: Draft = {
  name:            '',
  tagline:         '',
  description:     '',
  asset_classes:   ['forex'],
  timeframes:      ['H4'],
  is_free:         false,
  price_monthly:   29,
  price_annual:    undefined,
  copy_enabled:    false,
  copy_mode:       'signal_only',
  profit_share_pct: 20,
}

export default function PublishStrategyWizard() {
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<Draft>(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  function toggleArray(key: 'asset_classes' | 'timeframes', value: string) {
    setDraft(d => {
      const set = new Set(d[key])
      if (set.has(value)) set.delete(value)
      else set.add(value)
      return { ...d, [key]: Array.from(set) }
    })
  }

  function submit() {
    setError(null)

    // Validation
    if (draft.name.length < 3)       return setError('Name must be at least 3 characters')
    if (draft.tagline.length < 10)   return setError('Tagline must be at least 10 characters')
    if (draft.asset_classes.length === 0) return setError('Select at least one asset class')
    if (!draft.is_free && draft.price_monthly < 1) return setError('Set a monthly price or mark as free')

    startTransition(async () => {
      try {
        const res = await fetch('/api/social/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            // strip empty / undefined fields
            price_monthly:  draft.is_free ? undefined : draft.price_monthly,
            price_annual:   draft.is_free ? undefined : draft.price_annual,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to create')
        // Redirect to detail page
        window.location.href = `/dashboard/strategies/${data.strategy.slug}`
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-2">
        {[1, 2, 3, 4].map(n => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div className={cn(
              'h-7 w-7 rounded-full border flex items-center justify-center text-xs font-bold transition-colors',
              step >= n
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                : 'border-border text-muted-foreground',
            )}>
              {n}
            </div>
            {n < 4 && <div className={cn(
              'h-px flex-1 transition-colors',
              step > n ? 'bg-amber-500/40' : 'bg-border',
            )} />}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        {/* Step 1 — Identity */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold mb-1">Identity</h2>
              <p className="text-xs text-muted-foreground">Make it discoverable.</p>
            </div>

            <Field label="Name" hint="3-80 characters">
              <input
                type="text"
                value={draft.name}
                onChange={e => update('name', e.target.value)}
                placeholder="e.g. Gold Scalper Pro"
                maxLength={80}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
              />
            </Field>

            <Field label="Tagline" hint="One-line pitch (max 120 chars)">
              <input
                type="text"
                value={draft.tagline}
                onChange={e => update('tagline', e.target.value)}
                placeholder="e.g. Institutional-grade XAUUSD scalping with 2:1 R:R"
                maxLength={120}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
              />
            </Field>

            <Field label="Description" hint="Markdown supported (max 2000 chars)">
              <textarea
                value={draft.description}
                onChange={e => update('description', e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="Describe your edge, entry/exit logic, risk management..."
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40"
              />
            </Field>
          </div>
        )}

        {/* Step 2 — Spec */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold mb-1">Strategy Spec</h2>
              <p className="text-xs text-muted-foreground">What does it trade?</p>
            </div>

            <Field label="Asset Classes" hint="Pick all that apply">
              <div className="flex flex-wrap gap-1.5">
                {ASSET_OPTIONS.map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleArray('asset_classes', a)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                      draft.asset_classes.includes(a)
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Timeframes">
              <div className="flex flex-wrap gap-1.5">
                {TIMEFRAME_OPTIONS.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleArray('timeframes', t)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      draft.timeframes.includes(t)
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Trading Style">
                <select
                  value={draft.trading_style ?? ''}
                  onChange={e => update('trading_style', (e.target.value || undefined) as Draft['trading_style'])}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {STYLE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </Field>

              <Field label="Risk Approach">
                <select
                  value={draft.risk_approach ?? ''}
                  onChange={e => update('risk_approach', (e.target.value || undefined) as Draft['risk_approach'])}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="">— Select —</option>
                  {RISK_OPTIONS.map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* Step 3 — Pricing */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold mb-1">Pricing</h2>
              <p className="text-xs text-muted-foreground">
                You keep 70% of every subscription. Platform fee 30%.
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.is_free}
                onChange={e => update('is_free', e.target.checked)}
                className="accent-amber-400"
              />
              <span className="text-sm font-medium">Free strategy (build audience first)</span>
            </label>

            {!draft.is_free && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Monthly Price (USD)">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={draft.price_monthly}
                    onChange={e => update('price_monthly', parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    You receive ${(draft.price_monthly * 0.7).toFixed(2)} per sub
                  </p>
                </Field>

                <Field label="Annual Price (USD)" hint="Auto = 20% off monthly × 12">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={draft.price_annual ?? ''}
                    placeholder={`${(draft.price_monthly * 12 * 0.8).toFixed(0)} (auto)`}
                    onChange={e => update('price_annual', e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  />
                </Field>
              </div>
            )}

            <div className="border-t border-border/50 pt-4">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input
                  type="checkbox"
                  checked={draft.copy_enabled}
                  onChange={e => update('copy_enabled', e.target.checked)}
                  className="accent-amber-400"
                />
                <span className="text-sm font-medium">Enable copy trading</span>
              </label>

              {draft.copy_enabled && (
                <div className="space-y-3 pl-6">
                  <Field label="Default Copy Mode">
                    <select
                      value={draft.copy_mode}
                      onChange={e => update('copy_mode', e.target.value as Draft['copy_mode'])}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                    >
                      <option value="signal_only">Signal alerts only</option>
                      <option value="semi_auto">Semi-auto (1-tap confirm)</option>
                      <option value="full_auto">Full auto (VIP subscribers only)</option>
                    </select>
                  </Field>

                  <Field label={`Profit Share % — ${draft.profit_share_pct}%`}>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={5}
                      value={draft.profit_share_pct}
                      onChange={e => update('profit_share_pct', parseInt(e.target.value, 10))}
                      className="w-full accent-amber-400"
                      aria-label="Profit share percentage"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Of follower profits (above high-water-mark). Common: 20%.
                    </p>
                  </Field>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 4 — Review & Publish */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold mb-1">Review</h2>
              <p className="text-xs text-muted-foreground">
                Strategy will save as a draft. Publish from the detail page when ready.
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-2 text-sm">
              <Row label="Name"          value={draft.name} />
              <Row label="Tagline"       value={draft.tagline} />
              <Row label="Asset Classes" value={draft.asset_classes.join(', ')} />
              <Row label="Timeframes"    value={draft.timeframes.join(', ')} />
              <Row label="Style"         value={draft.trading_style ?? '—'} />
              <Row label="Risk Approach" value={draft.risk_approach ?? '—'} />
              <Row label="Pricing"       value={draft.is_free ? 'Free' : `$${draft.price_monthly}/mo`} />
              <Row label="Copy Trading"  value={draft.copy_enabled ? `Enabled (${draft.copy_mode})` : 'Disabled'} />
              {draft.copy_enabled && (
                <Row label="Profit Share" value={`${draft.profit_share_pct}%`} />
              )}
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Auto-publish:</strong> Strategy
                auto-activates after 5 published live signals. Until then it stays in draft.
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-xs text-rose-400">{error}</p>
        )}

        {/* Nav */}
        <div className="mt-6 flex justify-between gap-2">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep(s => Math.max(1, s - 1))}
            className={cn(
              'rounded-lg border border-border px-4 py-2 text-xs font-medium',
              step === 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-muted/30',
            )}
          >
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(s => Math.min(4, s + 1))}
              className="btn-premium !text-xs !py-2 !px-5"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className={cn(
                'btn-premium !text-xs !py-2 !px-5',
                pending && 'opacity-60 cursor-wait',
              )}
            >
              {pending ? 'Creating…' : 'Create Strategy'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  )
}
