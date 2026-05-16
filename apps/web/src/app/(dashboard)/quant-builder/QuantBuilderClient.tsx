'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  runBacktest,
  syntheticBars,
  type BacktestConfig,
  type BacktestResult,
  type StrategyType,
} from '@/lib/backtest'

type LogicOp = 'AND' | 'OR'

interface Rule {
  id:        string
  indicator: 'ema_fast' | 'ema_slow' | 'rsi' | 'macd_hist' | 'bb_pct' | 'price'
  op:        '>' | '<' | 'crosses_above' | 'crosses_below'
  ref:       'ema_slow' | 'ema_fast' | 'value'
  value?:    number
}

const INDICATORS: { key: Rule['indicator']; label: string }[] = [
  { key: 'ema_fast',  label: 'EMA Fast'   },
  { key: 'ema_slow',  label: 'EMA Slow'   },
  { key: 'rsi',       label: 'RSI(14)'    },
  { key: 'macd_hist', label: 'MACD Hist'  },
  { key: 'bb_pct',    label: 'BB %B'      },
  { key: 'price',     label: 'Close Price'},
]

const STRATEGY_PRESETS: { key: StrategyType; label: string; description: string }[] = [
  { key: 'ema_trend',     label: 'EMA Trend',     description: 'Fast EMA crosses slow EMA → trade the trend' },
  { key: 'rsi_reversion', label: 'RSI Reversion', description: 'Buy oversold, sell overbought' },
  { key: 'breakout',      label: 'Channel Break', description: 'Trade close beyond N-bar high/low' },
]

const inputCls =
  'rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-500/40'

let nextId = 0
const mkId = () => `r${++nextId}`

export default function QuantBuilderClient() {
  // Long-side rule list (visual no-code)
  const [longRules, setLongRules] = useState<Rule[]>([
    { id: mkId(), indicator: 'ema_fast', op: 'crosses_above', ref: 'ema_slow' },
    { id: mkId(), indicator: 'rsi',      op: '<',             ref: 'value', value: 65 },
  ])
  const [logicOp, setLogicOp] = useState<LogicOp>('AND')

  // Compiled preset (maps the rules to one of the canonical strategies)
  const compiledStrategy: StrategyType = useMemo(() => compileToStrategy(longRules), [longRules])

  const [riskPct, setRiskPct] = useState(1)
  const [rr, setRr]           = useState(2)
  const [slAtr, setSlAtr]     = useState(1.5)
  const [bars, setBars]       = useState(800)
  const [seed, setSeed]       = useState(42)
  const [result, setResult]   = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)

  function addRule() {
    setLongRules(r => [...r, { id: mkId(), indicator: 'rsi', op: '<', ref: 'value', value: 30 }])
  }
  function removeRule(id: string) {
    setLongRules(r => r.length > 1 ? r.filter(x => x.id !== id) : r)
  }
  function updateRule(id: string, patch: Partial<Rule>) {
    setLongRules(r => r.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  function loadPreset(s: StrategyType) {
    if (s === 'ema_trend') setLongRules([
      { id: mkId(), indicator: 'ema_fast', op: 'crosses_above', ref: 'ema_slow' },
      { id: mkId(), indicator: 'rsi',      op: '<',             ref: 'value', value: 65 },
    ])
    else if (s === 'rsi_reversion') setLongRules([
      { id: mkId(), indicator: 'rsi', op: '<', ref: 'value', value: 30 },
    ])
    else setLongRules([
      { id: mkId(), indicator: 'price', op: '>', ref: 'value', value: 0 },
    ])
  }

  function run() {
    setRunning(true)
    setTimeout(() => {
      const cfg: BacktestConfig = {
        strategy: compiledStrategy,
        startingEquity: 10000,
        riskPct, rrTarget: rr, slAtrMult: slAtr,
        rsiOversold:   longRules.find(r => r.indicator === 'rsi' && r.op === '<')?.value ?? 30,
        rsiOverbought: longRules.find(r => r.indicator === 'rsi' && r.op === '>')?.value ?? 70,
      }
      setResult(runBacktest(syntheticBars(bars, seed), cfg))
      setRunning(false)
    }, 50)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5">
      {/* Rule builder */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Presets
          </p>
          <div className="space-y-1.5">
            {STRATEGY_PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => loadPreset(p.key)}
                className={cn(
                  'w-full text-left rounded-lg border px-3 py-2 transition-colors',
                  compiledStrategy === p.key
                    ? 'border-amber-500/40 bg-amber-500/[0.06]'
                    : 'border-border hover:border-border/80',
                )}
              >
                <p className="text-xs font-bold">{p.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{p.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
              Long Entry Rules
            </p>
            <select
              value={logicOp}
              onChange={e => setLogicOp(e.target.value as LogicOp)}
              className={inputCls}
              aria-label="Logic operator"
            >
              <option value="AND">ALL (AND)</option>
              <option value="OR">ANY (OR)</option>
            </select>
          </div>

          <div className="space-y-2">
            {longRules.map((r, i) => (
              <div key={r.id} className="rounded-lg border border-border/60 bg-background/30 p-2.5">
                {i > 0 && (
                  <p className="text-[10px] text-amber-300 font-bold mb-1.5">{logicOp}</p>
                )}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <select
                    value={r.indicator}
                    onChange={e => updateRule(r.id, { indicator: e.target.value as Rule['indicator'] })}
                    className={inputCls}
                    aria-label="Indicator"
                  >
                    {INDICATORS.map(ind => <option key={ind.key} value={ind.key}>{ind.label}</option>)}
                  </select>
                  <select
                    value={r.op}
                    onChange={e => updateRule(r.id, { op: e.target.value as Rule['op'] })}
                    className={inputCls}
                    aria-label="Operator"
                  >
                    <option value=">">{'>'}</option>
                    <option value="<">{'<'}</option>
                    <option value="crosses_above">crosses ↗</option>
                    <option value="crosses_below">crosses ↘</option>
                  </select>
                  {r.ref === 'value' ? (
                    <input
                      type="number"
                      value={r.value ?? 0}
                      onChange={e => updateRule(r.id, { value: +e.target.value })}
                      className={`${inputCls} w-20`}
                      aria-label="Threshold"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground italic">EMA Slow</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeRule(r.id)}
                    disabled={longRules.length <= 1}
                    className="ml-auto text-rose-400 text-xs disabled:opacity-30"
                    aria-label="Remove rule"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRule}
            className="mt-3 w-full rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-amber-500/40 hover:text-amber-300 transition-colors"
          >
            + Add rule
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
            Risk Sizing
          </p>
          <Slider label={`Risk % per trade — ${riskPct}%`} min={0.25} max={3} step={0.25} value={riskPct} onChange={setRiskPct} />
          <Slider label={`R:R — 1:${rr}`} min={1} max={5} step={0.5} value={rr} onChange={setRr} />
          <Slider label={`Stop = ${slAtr}× ATR`} min={0.5} max={3} step={0.5} value={slAtr} onChange={setSlAtr} />
          <Slider label={`Bars — ${bars}`} min={300} max={2000} step={100} value={bars} onChange={setBars} />
          <Slider label={`Seed — ${seed}`} min={1} max={100} step={1} value={seed} onChange={setSeed} />
        </div>

        <button
          type="button"
          onClick={run}
          disabled={running}
          className={cn('btn-premium w-full !text-sm !py-2.5', running && 'opacity-60 cursor-wait')}
        >
          {running ? 'Running backtest…' : 'Run Backtest →'}
        </button>
      </div>

      {/* Results */}
      <div>
        {!result ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center text-sm text-muted-foreground">
            Compose your rules, then run the backtest. Synthetic GBM data — connect
            a broker (VIP) for live OHLCV.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Net P&L"  value={`${result.netPnl >= 0 ? '+' : ''}$${result.netPnl.toLocaleString()}`} tone={result.netPnl >= 0 ? 'green' : 'red'} />
              <Stat label="Return %" value={`${result.netPnlPct >= 0 ? '+' : ''}${result.netPnlPct}%`} tone={result.netPnlPct >= 0 ? 'green' : 'red'} />
              <Stat label="Win Rate" value={`${result.winRate}%`} tone="gold" />
              <Stat label="Sharpe"   value={result.sharpe != null ? String(result.sharpe) : '—'} />
              <Stat label="Trades"   value={String(result.totalTrades)} />
              <Stat label="Max DD"   value={`${result.maxDrawdownPct}%`} tone="red" />
              <Stat label="Profit Factor" value={String(result.profitFactor)} />
              <Stat label="Avg W / L" value={`$${result.avgWin} / $${result.avgLoss}`} />
            </div>

            {result.totalTrades > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
                <p className="text-xs uppercase tracking-widest text-amber-300 font-bold mb-2">
                  Ready to publish?
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Strategies that show a Sharpe ≥ 1 and ≥30 trades become eligible for
                  publishing to the marketplace.
                </p>
                <a
                  href="/dashboard/strategies/new"
                  className={cn(
                    'btn-premium !text-xs !py-2 !px-4 inline-block',
                    ((result.sharpe ?? 0) < 1 || result.totalTrades < 30) && 'opacity-50 pointer-events-none',
                  )}
                >
                  Publish Strategy →
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Map a rule set to one of the canonical compiled strategies.
function compileToStrategy(rules: Rule[]): StrategyType {
  if (rules.some(r => r.indicator === 'ema_fast' && r.op.startsWith('crosses'))) return 'ema_trend'
  if (rules.every(r => r.indicator === 'rsi'))                                    return 'rsi_reversion'
  if (rules.some(r => r.indicator === 'price' && r.op === '>'))                   return 'breakout'
  return 'ema_trend'
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number
  value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        {label}
      </label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full accent-amber-400" aria-label={label}
      />
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: {
  label: string; value: string; tone?: 'plain' | 'green' | 'red' | 'gold'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-base font-bold tabular-nums',
        tone === 'green' && 'text-emerald-400',
        tone === 'red'   && 'text-rose-400',
        tone === 'gold'  && 'text-amber-300',
      )}>
        {value}
      </p>
    </div>
  )
}
