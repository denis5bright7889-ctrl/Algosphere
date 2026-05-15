'use client'

import { useState } from 'react'
import type { Strategy } from '@/lib/types'
import { cn } from '@/lib/utils'

const PAIRS = ['XAUUSD','EURUSD','GBPUSD','USDJPY','GBPJPY','AUDUSD','USDCAD','EURJPY','XAGUSD','US30','NAS100']
const REGIMES = ['trending','ranging','volatile','dead','breakout','compression']
const SESSIONS = ['asian','london','new_york','london_ny','off_hours']

interface Props {
  strategies: Strategy[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreated: (signal: any) => void
}

export default function CreateSignalForm({ strategies, onCreated }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    pair: 'XAUUSD',
    direction: 'buy' as 'buy' | 'sell',
    entry_price: '',
    stop_loss: '',
    take_profit_1: '',
    take_profit_2: '',
    take_profit_3: '',
    tier_required: 'starter' as 'free' | 'starter' | 'premium',
    strategy_id: '',
    confidence_score: '75',
    regime: 'trending',
    session: 'london',
    admin_notes: '',
  })

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  // Live R:R preview
  const rr = (() => {
    const entry = parseFloat(form.entry_price)
    const sl = parseFloat(form.stop_loss)
    const tp1 = parseFloat(form.take_profit_1)
    if (!entry || !sl || !tp1) return null
    const risk = Math.abs(entry - sl)
    return risk > 0 ? Math.round((Math.abs(tp1 - entry) / risk) * 100) / 100 : null
  })()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const body = {
      pair: form.pair,
      direction: form.direction,
      entry_price: parseFloat(form.entry_price),
      stop_loss: parseFloat(form.stop_loss),
      take_profit_1: parseFloat(form.take_profit_1),
      take_profit_2: form.take_profit_2 ? parseFloat(form.take_profit_2) : undefined,
      take_profit_3: form.take_profit_3 ? parseFloat(form.take_profit_3) : undefined,
      tier_required: form.tier_required,
      strategy_id: form.strategy_id || undefined,
      confidence_score: parseInt(form.confidence_score),
      regime: form.regime,
      session: form.session,
      admin_notes: form.admin_notes || undefined,
    }

    const res = await fetch('/api/admin/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { setError(JSON.stringify(data.error)); setLoading(false); return }
    onCreated(data.data)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-primary/30 bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Publish New Intelligence Signal</h2>
        {rr && (
          <span className={cn('rounded-full px-3 py-1 text-sm font-bold', rr >= 2 ? 'bg-green-100 text-green-700' : rr >= 1.5 ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700')}>
            R:R 1:{rr}
          </span>
        )}
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {/* Row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <F label="Pair">
          <select value={form.pair} onChange={e => set('pair', e.target.value)} className={sel}>
            {PAIRS.map(p => <option key={p}>{p}</option>)}
            <option value="">Custom…</option>
          </select>
        </F>
        <F label="Direction">
          <div className="flex gap-2">
            {(['buy','sell'] as const).map(d => (
              <button key={d} type="button" onClick={() => set('direction', d)}
                className={cn('flex-1 rounded-md border px-2 py-2 text-sm font-semibold capitalize',
                  form.direction === d ? d === 'buy' ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600' : 'border-border hover:bg-accent')}>
                {d}
              </button>
            ))}
          </div>
        </F>
        <F label="Tier">
          <select value={form.tier_required} onChange={e => set('tier_required', e.target.value)} className={sel}>
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="premium">Premium</option>
          </select>
        </F>
        <F label="Strategy">
          <select value={form.strategy_id} onChange={e => set('strategy_id', e.target.value)} className={sel}>
            <option value="">— none —</option>
            {strategies.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
        </F>
      </div>

      {/* Row 2 — Price levels */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <F label="Entry *"><input required type="number" step="any" placeholder="0.00" value={form.entry_price} onChange={e => set('entry_price', e.target.value)} className={inp} /></F>
        <F label="Stop Loss *"><input required type="number" step="any" placeholder="0.00" value={form.stop_loss} onChange={e => set('stop_loss', e.target.value)} className={cn(inp, 'text-red-600')} /></F>
        <F label="TP 1 *"><input required type="number" step="any" placeholder="0.00" value={form.take_profit_1} onChange={e => set('take_profit_1', e.target.value)} className={cn(inp, 'text-green-600')} /></F>
        <F label="TP 2"><input type="number" step="any" placeholder="0.00" value={form.take_profit_2} onChange={e => set('take_profit_2', e.target.value)} className={cn(inp, 'text-green-600')} /></F>
        <F label="TP 3"><input type="number" step="any" placeholder="0.00" value={form.take_profit_3} onChange={e => set('take_profit_3', e.target.value)} className={cn(inp, 'text-green-600')} /></F>
      </div>

      {/* Row 3 — Intelligence */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <F label={`Confidence: ${form.confidence_score}%`}>
          <input type="range" min="0" max="100" value={form.confidence_score} onChange={e => set('confidence_score', e.target.value)}
            className="w-full accent-primary" />
        </F>
        <F label="Market Regime">
          <select value={form.regime} onChange={e => set('regime', e.target.value)} className={sel}>
            {REGIMES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
          </select>
        </F>
        <F label="Session">
          <select value={form.session} onChange={e => set('session', e.target.value)} className={sel}>
            {SESSIONS.map(s => <option key={s} value={s} className="capitalize">{s.replace('_', '/')}</option>)}
          </select>
        </F>
        <F label="Notes">
          <input type="text" placeholder="Analyst notes…" value={form.admin_notes} onChange={e => set('admin_notes', e.target.value)} className={inp} />
        </F>
      </div>

      <button type="submit" disabled={loading}
        className={cn('w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors', loading && 'opacity-50 cursor-not-allowed')}>
        {loading ? 'Publishing…' : '⚡ Publish Signal'}
      </button>
    </form>
  )
}

const inp = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const sel = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">{label}</label>{children}</div>
}
