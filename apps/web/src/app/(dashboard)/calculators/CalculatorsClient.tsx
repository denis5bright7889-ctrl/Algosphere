'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  calcPositionSize,
  calcRiskReward,
  calcPipValue,
  COMMON_PAIRS,
} from '@/lib/calculators'

const TABS = ['position', 'pip', 'risk-reward'] as const
type Tab = typeof TABS[number]

export default function CalculatorsClient() {
  const [tab, setTab] = useState<Tab>('position')

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-5">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-colors capitalize',
              tab === t ? 'text-amber-300' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.replace('-', ' / ')}
            {tab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-300" />}
          </button>
        ))}
      </div>

      {tab === 'position'    && <PositionSizer />}
      {tab === 'pip'         && <PipCalc />}
      {tab === 'risk-reward' && <RiskRewardCalc />}
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

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-amber-500/40'

function PairSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls} aria-label="Pair">
      {COMMON_PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  )
}

function Result({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'gold' | 'green' | 'red' | 'plain'
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-xl font-bold tabular-nums',
        tone === 'gold'  && 'text-amber-300 glow-text-gold',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
      )}>
        {value}
      </p>
    </div>
  )
}

// ─── Position Sizer ──────────────────────────────────────────
function PositionSizer() {
  const [balance, setBalance] = useState(10000)
  const [riskPct, setRiskPct] = useState(1)
  const [pair, setPair]       = useState('XAUUSD')
  const [entry, setEntry]     = useState(2381.4)
  const [sl, setSl]           = useState(2371.0)
  const [leverage, setLev]    = useState(100)

  const r = useMemo(() => calcPositionSize({
    accountBalance: balance, riskPct, pair, entry, stopLoss: sl, leverage,
  }), [balance, riskPct, pair, entry, sl, leverage])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <Field label="Account Balance ($)">
          <input type="number" value={balance} onChange={e => setBalance(+e.target.value)} className={inputCls} />
        </Field>
        <Field label={`Risk % — risking $${r.riskAmount.toLocaleString()}`}>
          <input type="range" min={0.25} max={5} step={0.25} value={riskPct}
            onChange={e => setRiskPct(+e.target.value)} className="w-full accent-amber-400" aria-label="Risk percent" />
        </Field>
        <Field label="Pair"><PairSelect value={pair} onChange={setPair} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entry"><input type="number" value={entry} onChange={e => setEntry(+e.target.value)} className={inputCls} /></Field>
          <Field label="Stop Loss"><input type="number" value={sl} onChange={e => setSl(+e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Leverage">
          <select value={leverage} onChange={e => setLev(+e.target.value)} className={inputCls} aria-label="Leverage">
            {[10,20,30,50,100,200,500].map(l => <option key={l} value={l}>1:{l}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 content-start">
        <div className="col-span-2">
          <Result label="Position Size" value={`${r.lots} lots`} tone="gold" />
        </div>
        <Result label="Risk Amount" value={`$${r.riskAmount.toLocaleString()}`} tone="red" />
        <Result label="SL Distance" value={`${r.slPips} pips`} />
        <Result label="Pip Value" value={`$${r.pipValue}/lot`} />
        <Result label="Margin Required" value={`$${r.marginUsd.toLocaleString()}`} />
      </div>
    </div>
  )
}

// ─── Pip Calculator ──────────────────────────────────────────
function PipCalc() {
  const [pair, setPair] = useState('EURUSD')
  const [lots, setLots] = useState(1)
  const r = useMemo(() => calcPipValue({ pair, lots }), [pair, lots])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <Field label="Pair"><PairSelect value={pair} onChange={setPair} /></Field>
        <Field label="Lots">
          <input type="number" step={0.01} value={lots} onChange={e => setLots(+e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 content-start">
        <Result label="1 Pip"    value={`$${r.perPip}`}     tone="gold" />
        <Result label="10 Pips"  value={`$${r.per10Pips}`} />
        <Result label="100 Pips" value={`$${r.per100Pips}`} tone="green" />
      </div>
    </div>
  )
}

// ─── Risk / Reward ───────────────────────────────────────────
function RiskRewardCalc() {
  const [pair, setPair] = useState('XAUUSD')
  const [entry, setEntry] = useState(2381.4)
  const [sl, setSl]   = useState(2371.0)
  const [tp, setTp]   = useState(2402.0)
  const r = useMemo(() => calcRiskReward({ pair, entry, stopLoss: sl, takeProfit: tp }), [pair, entry, sl, tp])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <Field label="Pair"><PairSelect value={pair} onChange={setPair} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Entry"><input type="number" value={entry} onChange={e => setEntry(+e.target.value)} className={inputCls} /></Field>
          <Field label="SL"><input type="number" value={sl} onChange={e => setSl(+e.target.value)} className={inputCls} /></Field>
          <Field label="TP"><input type="number" value={tp} onChange={e => setTp(+e.target.value)} className={inputCls} /></Field>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 content-start">
        <div className="col-span-2">
          <Result label="Risk : Reward" value={`1 : ${r.ratio}`} tone="gold" />
        </div>
        <Result label="Risk" value={`${r.riskPips} pips`} tone="red" />
        <Result label="Reward" value={`${r.rewardPips} pips`} tone="green" />
        <div className="col-span-2">
          <Result label="Breakeven Win Rate" value={`${r.breakeven}%`} />
        </div>
      </div>
    </div>
  )
}
