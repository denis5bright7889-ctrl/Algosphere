'use client'

import { useState } from 'react'
import type { JournalEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

const SETUP_TAGS = ['breakout', 'trend', 'reversal', 'range', 'news', 'scalp']

interface Props {
  userId: string
  onAdded: (entry: JournalEntry) => void
  onClose: () => void
}

export default function AddTradeModal({ onAdded, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    pair: '',
    direction: 'buy' as 'buy' | 'sell',
    entry_price: '',
    exit_price: '',
    lot_size: '',
    pips: '',
    pnl: '',
    risk_amount: '',
    setup_tag: '',
    notes: '',
    trade_date: new Date().toISOString().slice(0, 10),
  })

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const body = {
      pair: form.pair,
      direction: form.direction,
      trade_date: form.trade_date,
      entry_price: form.entry_price ? parseFloat(form.entry_price) : undefined,
      exit_price: form.exit_price ? parseFloat(form.exit_price) : undefined,
      lot_size: form.lot_size ? parseFloat(form.lot_size) : undefined,
      pips: form.pips ? parseFloat(form.pips) : undefined,
      pnl: form.pnl ? parseFloat(form.pnl) : undefined,
      risk_amount: form.risk_amount ? parseFloat(form.risk_amount) : undefined,
      setup_tag: form.setup_tag || undefined,
      notes: form.notes || undefined,
    }

    const res = await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong')
      setLoading(false)
      return
    }
    onAdded(json.data as JournalEntry)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl bg-card border border-border shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Log a trade</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {/* Row 1 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pair *">
              <input
                required
                placeholder="XAUUSD"
                value={form.pair}
                onChange={(e) => set('pair', e.target.value.toUpperCase())}
                className={inputCls}
              />
            </Field>
            <Field label="Date *" htmlFor="trade-date">
              <input
                id="trade-date"
                required
                type="date"
                title="Trade date"
                value={form.trade_date}
                onChange={(e) => set('trade_date', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Direction */}
          <Field label="Direction *">
            <div className="flex gap-2">
              {(['buy', 'sell'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('direction', d)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-sm font-semibold capitalize transition-colors',
                    form.direction === d
                      ? d === 'buy'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-red-600 text-white border-red-600'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>

          {/* Prices */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry price">
              <input type="number" step="any" placeholder="0.00" value={form.entry_price} onChange={(e) => set('entry_price', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Exit price">
              <input type="number" step="any" placeholder="0.00" value={form.exit_price} onChange={(e) => set('exit_price', e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* Sizing */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Lot size">
              <input type="number" step="any" placeholder="0.01" value={form.lot_size} onChange={(e) => set('lot_size', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Pips">
              <input type="number" step="any" placeholder="±50" value={form.pips} onChange={(e) => set('pips', e.target.value)} className={inputCls} />
            </Field>
            <Field label="P&L ($)">
              <input type="number" step="any" placeholder="±100" value={form.pnl} onChange={(e) => set('pnl', e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Risk amount ($)">
              <input type="number" step="any" placeholder="50" value={form.risk_amount} onChange={(e) => set('risk_amount', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Setup" htmlFor="setup-tag">
              <select id="setup-tag" aria-label="Setup tag" value={form.setup_tag} onChange={(e) => set('setup_tag', e.target.value)} className={inputCls}>
                <option value="">— none —</option>
                {SETUP_TAGS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              rows={3}
              placeholder="What was the setup? What went well or wrong?"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className={cn(inputCls, 'resize-none')}
            />
          </Field>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={cn('flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90', loading && 'opacity-50 cursor-not-allowed')}
            >
              {loading ? 'Saving…' : 'Save trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  const id = htmlFor ?? label.toLowerCase().replace(/[^a-z0-9]/g, '-')
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
