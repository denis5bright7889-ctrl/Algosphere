'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  runBacktest,
  syntheticBars,
  type BacktestConfig,
  type BacktestResult,
  type StrategyType,
} from '@/lib/backtest'

const STRATEGIES: { key: StrategyType; label: string }[] = [
  { key: 'ema_trend',     label: 'EMA Trend Crossover' },
  { key: 'rsi_reversion', label: 'RSI Mean Reversion' },
  { key: 'breakout',      label: 'Channel Breakout' },
]

export default function BacktestClient() {
  const [strategy, setStrategy] = useState<StrategyType>('ema_trend')
  const [riskPct, setRiskPct]   = useState(1)
  const [rr, setRr]             = useState(2)
  const [slAtr, setSlAtr]       = useState(1.5)
  const [bars, setBars]         = useState(500)
  const [seed, setSeed]         = useState(42)
  const [result, setResult]     = useState<BacktestResult | null>(null)
  const [running, setRunning]   = useState(false)

  function run() {
    setRunning(true)
    // Synchronous but yield a tick for the spinner
    setTimeout(() => {
      const cfg: BacktestConfig = {
        strategy,
        startingEquity: 10000,
        riskPct,
        rrTarget: rr,
        slAtrMult: slAtr,
      }
      const data = syntheticBars(bars, seed)
      setResult(runBacktest(data, cfg))
      setRunning(false)
    }, 50)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      {/* Config */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4 h-fit">
        <Field label="Strategy">
          <select
            value={strategy}
            onChange={e => setStrategy(e.target.value as StrategyType)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
          >
            {STRATEGIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Slider label={`Risk per trade — ${riskPct}%`} min={0.25} max={5} step={0.25} value={riskPct} onChange={setRiskPct} />
        <Slider label={`Reward:Risk — 1:${rr}`} min={1} max={5} step={0.5} value={rr} onChange={setRr} />
        <Slider label={`Stop = ${slAtr}× ATR`} min={0.5} max={4} step={0.5} value={slAtr} onChange={setSlAtr} />
        <Slider label={`Bars — ${bars}`} min={200} max={2000} step={100} value={bars} onChange={setBars} />
        <Field label="Random Seed">
          <input
            type="number"
            value={seed}
            onChange={e => setSeed(+e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
          />
        </Field>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className={cn('btn-premium w-full !text-sm !py-2.5', running && 'opacity-60 cursor-wait')}
        >
          {running ? 'Running…' : 'Run Backtest'}
        </button>
        <p className="text-[10px] text-muted-foreground">
          Uses synthetic GBM price series (deterministic by seed). Connect a broker
          in VIP to backtest on real historical data.
        </p>
      </div>

      {/* Results */}
      <div>
        {!result ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center text-sm text-muted-foreground">
            Configure a strategy and run the backtest.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Net P&L" value={`${result.netPnl >= 0 ? '+' : ''}$${result.netPnl.toLocaleString()}`} tone={result.netPnl >= 0 ? 'green' : 'red'} />
              <Stat label="Return" value={`${result.netPnlPct >= 0 ? '+' : ''}${result.netPnlPct}%`} tone={result.netPnlPct >= 0 ? 'green' : 'red'} />
              <Stat label="Win Rate" value={`${result.winRate}%`} tone="gold" />
              <Stat label="Trades" value={String(result.totalTrades)} />
              <Stat label="Max DD" value={`${result.maxDrawdownPct}%`} tone="red" />
              <Stat label="Sharpe" value={result.sharpe != null ? String(result.sharpe) : '—'} />
              <Stat label="Profit Factor" value={String(result.profitFactor)} />
              <Stat label="Avg W / L" value={`$${result.avgWin} / $${result.avgLoss}`} />
            </div>

            <EquityChart curve={result.equityCurve} />

            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <p className="px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground border-b border-border">
                Last 12 Trades
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr className="text-left text-[10px] text-muted-foreground uppercase border-b border-border/40">
                      <th className="px-4 py-2">Dir</th>
                      <th className="px-4 py-2">Entry</th>
                      <th className="px-4 py-2">Exit</th>
                      <th className="px-4 py-2 text-right">P&L</th>
                      <th className="px-4 py-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-12).reverse().map((t, i) => (
                      <tr key={i} className="border-b border-border/30 last:border-0">
                        <td className={cn('px-4 py-2 font-bold', t.direction === 'long' ? 'text-emerald-400' : 'text-rose-400')}>
                          {t.direction.toUpperCase()}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{t.entry.toFixed(2)}</td>
                        <td className="px-4 py-2 tabular-nums">{t.exit.toFixed(2)}</td>
                        <td className={cn('px-4 py-2 text-right tabular-nums font-semibold', t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {t.result === 'win' ? '✅' : '❌'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number
  value: number; onChange: (v: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full accent-amber-400" aria-label={label}
      />
    </Field>
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

function EquityChart({ curve }: { curve: { time: number; equity: number }[] }) {
  if (curve.length < 2) return null
  const w = 600, h = 160, pad = 4
  const eqs = curve.map(c => c.equity)
  const min = Math.min(...eqs), max = Math.max(...eqs)
  const range = max - min || 1
  const pts = curve.map((c, i) => {
    const x = pad + (i / (curve.length - 1)) * (w - pad * 2)
    const y = h - pad - ((c.equity - min) / range) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const up = eqs[eqs.length - 1]! >= eqs[0]!

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Equity Curve</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" preserveAspectRatio="none">
        <polyline
          points={pts}
          fill="none"
          stroke={up ? 'rgb(52 211 153)' : 'rgb(251 113 133)'}
          strokeWidth="2"
        />
      </svg>
    </div>
  )
}
