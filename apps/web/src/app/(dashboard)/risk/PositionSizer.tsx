'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const PIP_VALUES: Record<string, number> = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDJPY: 9.1, USDCHF: 11.2, USDCAD: 7.4,
  XAUUSD: 10, XAGUSD: 50, US30: 1, NAS100: 1,
}

export default function PositionSizer() {
  const [accountSize, setAccountSize] = useState('10000')
  const [riskPct, setRiskPct] = useState('1')
  const [slPips, setSlPips] = useState('')
  const [pair, setPair] = useState('XAUUSD')

  const riskAmount = (parseFloat(accountSize) || 0) * ((parseFloat(riskPct) || 0) / 100)
  const pipValue = PIP_VALUES[pair] ?? 10
  const slPipsNum = parseFloat(slPips) || 0
  const lotSize = slPipsNum > 0 ? riskAmount / (slPipsNum * pipValue) : 0

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="font-semibold">Position Size Calculator</h2>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Account size ($)">
          <input
            type="number"
            value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)}
            className={inputCls}
            placeholder="10000"
          />
        </Field>
        <Field label="Risk (%)">
          <div className="relative">
            <input
              type="number"
              step="0.1"
              max="5"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
              className={inputCls}
              placeholder="1"
            />
          </div>
        </Field>
        <Field label="Pair">
          <select value={pair} onChange={(e) => setPair(e.target.value)} className={inputCls}>
            {Object.keys(PIP_VALUES).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Stop loss (pips)">
          <input
            type="number"
            value={slPips}
            onChange={(e) => setSlPips(e.target.value)}
            className={inputCls}
            placeholder="30"
          />
        </Field>
      </div>

      {/* Quick risk % buttons */}
      <div className="flex gap-2">
        {['0.5', '1', '1.5', '2'].map((p) => (
          <button
            key={p}
            onClick={() => setRiskPct(p)}
            className={cn(
              'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
              riskPct === p ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'
            )}
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="rounded-lg bg-muted/40 p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Risk amount</span>
          <span className="font-semibold">${riskAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Pip value ({pair})</span>
          <span className="font-semibold">${pipValue}/pip/lot</span>
        </div>
        <div className="border-t border-border pt-3 flex justify-between">
          <span className="font-semibold">Lot size</span>
          <span className={cn('text-xl font-bold', lotSize > 0 ? 'text-primary' : 'text-muted-foreground')}>
            {lotSize > 0 ? lotSize.toFixed(2) : '—'}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Formula: Lot size = Risk $ ÷ (SL pips × pip value per lot)
      </p>
    </div>
  )
}

const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
