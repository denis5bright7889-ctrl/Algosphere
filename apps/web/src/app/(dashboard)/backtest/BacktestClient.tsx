'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, XCircle, Sparkles, FlaskConical, Database, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  runBacktest, syntheticBars,
  type Bar,
  type BacktestConfig, type BacktestResult, type StrategyType,
} from '@/lib/backtest'
import {
  executeStrategy, DEFAULT_COSTS, defaultCostsFor,
  type CostModel, type ExecuteResult,
} from '@/lib/strategies/executor'
import {
  runMonteCarlo, type MonteCarloResult,
} from '@/lib/strategies/monte-carlo'
import type { StrategyConfig } from '@/lib/strategies/blocks'
import StrategyDiagnosticsPanel from '@/components/backtest/StrategyDiagnosticsPanel'


export interface SavedStrategyOption {
  id:      string
  name:    string
  version: number | null
  config:  StrategyConfig | null
}


const STRATEGIES: { key: StrategyType; label: string }[] = [
  { key: 'ema_trend',     label: 'EMA Trend Crossover' },
  { key: 'rsi_reversion', label: 'RSI Mean Reversion' },
  { key: 'breakout',      label: 'Channel Breakout' },
]


/**
 * Symbol list for the historical-data picker. Forex/metals route
 * through TwelveData on the engine; crypto goes via the engine's
 * Coinbase fallback. Both are read-only and stable, so we don't need
 * to fan out a registry call — keep the list curated and short.
 */
const HISTORICAL_SYMBOLS: { value: string; label: string; group: string }[] = [
  { group: 'Forex',     value: 'EURUSD',  label: 'EUR/USD' },
  { group: 'Forex',     value: 'GBPUSD',  label: 'GBP/USD' },
  { group: 'Forex',     value: 'USDJPY',  label: 'USD/JPY' },
  { group: 'Forex',     value: 'AUDUSD',  label: 'AUD/USD' },
  { group: 'Forex',     value: 'USDCHF',  label: 'USD/CHF' },
  { group: 'Metals',    value: 'XAUUSD',  label: 'Gold (XAU/USD)' },
  { group: 'Crypto',    value: 'BTCUSDT', label: 'BTC/USDT' },
  { group: 'Crypto',    value: 'ETHUSDT', label: 'ETH/USDT' },
  { group: 'Crypto',    value: 'SOLUSDT', label: 'SOL/USDT' },
  { group: 'Crypto',    value: 'XRPUSDT', label: 'XRP/USDT' },
]

const TIMEFRAMES: { value: string; label: string }[] = [
  { value: '5min',  label: '5m'  },
  { value: '15min', label: '15m' },
  { value: '30min', label: '30m' },
  { value: '1h',    label: '1h'  },
  { value: '4h',    label: '4h'  },
  { value: '1day',  label: '1d'  },
]


type Mode = 'built_in' | 'saved'
type DataSource = 'synthetic' | 'historical'


export default function BacktestClient({
  savedStrategies, initialStrategyId,
}: {
  savedStrategies:    SavedStrategyOption[]
  initialStrategyId:  string | null
}) {
  // Mode: deep link from /quant-builder?strategy_id=… → start in saved mode.
  const initialMode: Mode = initialStrategyId && savedStrategies.some((s) => s.id === initialStrategyId)
    ? 'saved' : (savedStrategies.length > 0 ? 'built_in' : 'built_in')

  const [mode, setMode] = useState<Mode>(initialMode)
  const [selectedId, setSelectedId] = useState<string>(
    initialStrategyId && savedStrategies.some((s) => s.id === initialStrategyId)
      ? initialStrategyId
      : (savedStrategies[0]?.id ?? ''),
  )

  // Built-in config knobs
  const [strategy, setStrategy] = useState<StrategyType>('ema_trend')
  const [riskPct, setRiskPct]   = useState(1)
  const [rr, setRr]             = useState(2)
  const [slAtr, setSlAtr]       = useState(1.5)

  // Bars + seed (synthetic only)
  const [bars, setBars] = useState(500)
  const [seed, setSeed] = useState(42)

  // Historical-data mode
  const [dataSource, setDataSource] = useState<DataSource>('synthetic')
  const [symbol,     setSymbol]     = useState('EURUSD')
  const [timeframe,  setTimeframe]  = useState('1h')
  const [histBars,   setHistBars]   = useState(500)

  // Cost model — defaults to a realistic per-symbol preset so runs
  // don't silently overstate edge with all-zero costs. User can still
  // override every field. Re-syncs when the user picks a new symbol.
  const initialCosts = useMemo(() => defaultCostsFor(symbol), [symbol])
  const [spreadPips,   setSpreadPips]   = useState(initialCosts.spread_pips)
  const [slipPct,      setSlipPct]      = useState(initialCosts.slippage_pct)
  const [commPct,      setCommPct]      = useState(initialCosts.commission_per_trade_pct)
  const [costsTouched, setCostsTouched] = useState(false)

  // When the symbol changes and the user hasn't manually edited costs,
  // re-seed the cost fields with the new symbol's preset. Once the user
  // touches any cost input, we stop auto-syncing so their values stick.
  useEffect(() => {
    if (costsTouched) return
    const preset = defaultCostsFor(symbol)
    setSpreadPips(preset.spread_pips)
    setSlipPct(preset.slippage_pct)
    setCommPct(preset.commission_per_trade_pct)
  }, [symbol, costsTouched])

  // Monte Carlo runs
  const [mcRuns, setMcRuns] = useState(1000)

  const [result, setResult]   = useState<BacktestResult | ExecuteResult | null>(null)
  const [mc, setMc]           = useState<MonteCarloResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const costs: CostModel = useMemo(() => ({
    spread_pips:              spreadPips,
    slippage_pct:             slipPct,
    commission_per_trade_pct: commPct,
    pip_value:                DEFAULT_COSTS.pip_value,
  }), [spreadPips, slipPct, commPct])

  /** Fetch real bars from the engine via the auth-gated web proxy.
   *  Returns null with `setError` populated on any failure so the
   *  caller can short-circuit. */
  async function fetchHistorical(): Promise<Bar[] | null> {
    try {
      const qs = new URLSearchParams({ symbol, interval: timeframe, outputsize: String(histBars) })
      const res = await fetch(`/api/backtest/ohlcv?${qs.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.detail || json?.error || `engine HTTP ${res.status}`)
        return null
      }
      if (json.error) {
        setError(`engine reported: ${json.error}`)
        return null
      }
      const rows: Array<Partial<Bar>> = Array.isArray(json.bars) ? json.bars : []
      if (rows.length === 0) {
        setError(`No historical bars available for ${symbol} @ ${timeframe}. Try a different symbol or timeframe.`)
        return null
      }
      // Engine returns OhlcvBar with `volume`; Bar shape ignores it.
      return rows
        .map((b) => ({
          time:  Number(b.time),
          open:  Number(b.open),
          high:  Number(b.high),
          low:   Number(b.low),
          close: Number(b.close),
        }))
        .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
      return null
    }
  }

  function run() {
    setRunning(true); setError(null); setMc(null)
    // Use async because fetchHistorical is async; setTimeout-yield kept
    // so the spinner has a chance to render before the heavy work.
    setTimeout(async () => {
      try {
        const data = dataSource === 'historical'
          ? await fetchHistorical()
          : syntheticBars(bars, seed)
        if (!data) return        // fetchHistorical already set the error
        if (data.length < 50) {
          setError(`Only ${data.length} bars returned; need at least 50.`)
          return
        }

        let r: BacktestResult | ExecuteResult
        if (mode === 'saved') {
          const sel = savedStrategies.find((s) => s.id === selectedId)
          if (!sel?.config) {
            setError('Pick a saved strategy with at least one version.')
            return
          }
          r = executeStrategy(data, sel.config, { startingEquity: 10_000, costs })
        } else {
          const cfg: BacktestConfig = {
            strategy, startingEquity: 10_000,
            riskPct, rrTarget: rr, slAtrMult: slAtr,
          }
          r = runBacktest(data, cfg)
        }

        setResult(r)
        const mcResult = runMonteCarlo(r, { runs: mcRuns, startingEquity: 10_000, seed })
        setMc(mcResult)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Run failed')
      } finally {
        setRunning(false)
      }
    }, 50)
  }

  // Re-run automatically if the URL deep-linked to a strategy
  useEffect(() => {
    if (initialMode === 'saved' && selectedId && !result) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      {/* Config */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4 h-fit">
        <div className="flex gap-1 rounded-lg border border-border p-1">
          <ModeButton active={mode === 'built_in'} onClick={() => setMode('built_in')} label="Built-in" />
          <ModeButton active={mode === 'saved'}    onClick={() => setMode('saved')}    label="My strategies" disabled={savedStrategies.length === 0} />
        </div>

        {mode === 'built_in' ? (
          <>
            <Field label="Strategy">
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as StrategyType)}
                aria-label="Strategy"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              >
                {STRATEGIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Slider label={`Risk per trade — ${riskPct}%`} min={0.25} max={5}   step={0.25} value={riskPct} onChange={setRiskPct} />
            <Slider label={`Reward:Risk — 1:${rr}`}        min={1}    max={5}   step={0.5}  value={rr}      onChange={setRr} />
            <Slider label={`Stop = ${slAtr}× ATR`}         min={0.5}  max={4}   step={0.5}  value={slAtr}   onChange={setSlAtr} />
          </>
        ) : (
          <>
            {savedStrategies.length === 0 ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-[11px] text-amber-200">
                No saved strategies yet. Open <a href="/quant-builder" className="underline">/quant-builder</a> to compose one.
              </p>
            ) : (
              <Field label="Saved strategy">
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  aria-label="Saved strategy"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                >
                  {savedStrategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.version != null ? ` · v${s.version}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p className="text-[10px] text-muted-foreground">
              Risk &amp; sizing come from the strategy&apos;s blocks (fixed_risk_per_trade,
              daily_loss_cap). Cost model below is applied at entry + exit.
            </p>
          </>
        )}

        {/* Data source toggle (R-followup): synthetic vs real engine bars */}
        <div className="flex gap-1 rounded-lg border border-border p-1">
          <ModeButton
            active={dataSource === 'synthetic'}
            onClick={() => setDataSource('synthetic')}
            label="Synthetic"
          />
          <ModeButton
            active={dataSource === 'historical'}
            onClick={() => setDataSource('historical')}
            label="Historical"
          />
        </div>

        {dataSource === 'synthetic' ? (
          <>
            <Slider label={`Bars — ${bars}`} min={200} max={2000} step={100} value={bars} onChange={setBars} />
            <Field label="Random seed">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(+e.target.value)}
                aria-label="Random seed"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Symbol">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                aria-label="Historical symbol"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              >
                {(['Forex','Metals','Crypto'] as const).map((g) => (
                  <optgroup key={g} label={g}>
                    {HISTORICAL_SYMBOLS.filter((s) => s.group === g).map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Timeframe">
              <div className="grid grid-cols-6 gap-1">
                {TIMEFRAMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTimeframe(t.value)}
                    aria-label={`Timeframe ${t.label}`}
                    className={cn(
                      'rounded-md border px-1.5 py-1.5 text-[11px] font-semibold tabular-nums',
                      timeframe === t.value
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                        : 'border-border bg-background/40 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
            <Slider label={`Bars — ${histBars}`} min={100} max={500} step={50} value={histBars} onChange={setHistBars} />
            <p className="rounded-md border border-border bg-background/40 p-2 text-[10px] text-muted-foreground/80 inline-flex items-start gap-1.5">
              <Database className="h-3 w-3 shrink-0 mt-0.5" />
              Bars come from the AlgoSphere data engine. When data is unavailable the run fails honestly — no synthetic fallback.
            </p>
          </>
        )}

        <details className="rounded-lg border border-border bg-background/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Cost model {!costsTouched && <span className="ml-2 normal-case text-[10px] font-medium text-amber-300/80">— realistic preset for {symbol}</span>}
          </summary>
          <div className="space-y-3 p-3">
            <Slider label={`Spread — ${spreadPips} pips`}    min={0} max={50} step={0.5} value={spreadPips} onChange={(v) => { setCostsTouched(true); setSpreadPips(v) }} />
            <Slider label={`Slippage — ${(slipPct * 100).toFixed(3)}%`} min={0} max={0.005} step={0.00005} value={slipPct} onChange={(v) => { setCostsTouched(true); setSlipPct(v) }} />
            <Slider label={`Commission — ${(commPct * 100).toFixed(3)}%`} min={0} max={0.005} step={0.00005} value={commPct} onChange={(v) => { setCostsTouched(true); setCommPct(v) }} />
          </div>
        </details>

        <details className="rounded-lg border border-border bg-background/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Monte Carlo
          </summary>
          <div className="p-3">
            <Slider label={`Runs — ${mcRuns}`} min={100} max={5000} step={100} value={mcRuns} onChange={setMcRuns} />
            <p className="mt-2 text-[10px] text-muted-foreground">
              Shuffles the order of the realised trades to estimate path-dependent risk.
            </p>
          </div>
        </details>

        <button
          type="button"
          onClick={run}
          disabled={running}
          className={cn('btn-premium w-full !text-sm !py-2.5', running && 'opacity-60 cursor-wait')}
        >
          {running ? 'Running…' : 'Run backtest'}
        </button>
        {error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-2 text-[11px] text-rose-200">
            {error}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground inline-flex items-start gap-1.5">
          {dataSource === 'synthetic' ? <Cpu className="h-3 w-3 shrink-0 mt-0.5" /> : <Database className="h-3 w-3 shrink-0 mt-0.5" />}
          {dataSource === 'synthetic'
            ? 'Synthetic GBM price series, deterministic by seed.'
            : `Live engine bars for ${symbol} @ ${timeframe}.`}
        </p>
      </div>

      {/* Results */}
      <div>
        {!result ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center text-sm text-muted-foreground">
            Pick a strategy and run the backtest.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Unsupported-blocks warning for user-authored configs */}
            {'unsupported_blocks' in result && result.unsupported_blocks.length > 0 && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] p-3 text-[11px] text-amber-200">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Approximate result
                </p>
                <p className="mt-1 leading-relaxed">
                  These blocks need live data and were skipped in the simulation:{' '}
                  <span className="font-mono">{result.unsupported_blocks.join(', ')}</span>.
                  The metrics below assume the blocks would always pass — real performance may differ.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Net P&L"       value={`${result.netPnl >= 0 ? '+' : ''}$${result.netPnl.toLocaleString()}`} tone={result.netPnl >= 0 ? 'green' : 'red'} />
              <Stat label="Return"        value={`${result.netPnlPct >= 0 ? '+' : ''}${result.netPnlPct}%`} tone={result.netPnlPct >= 0 ? 'green' : 'red'} />
              <Stat label="Win Rate"      value={`${result.winRate}%`} tone="gold" />
              <Stat label="Trades"        value={String(result.totalTrades)} />
              <Stat label="Max DD"        value={`${(result.maxDrawdownPct * 100).toFixed(2)}%`} tone="red" />
              <Stat label="Sharpe"        value={result.sharpe != null ? String(result.sharpe) : '—'} />
              <Stat label="Profit Factor" value={String(result.profitFactor)} />
              <Stat label="Avg W / L"     value={`$${result.avgWin} / $${result.avgLoss}`} />
            </div>

            <EquityChart curve={result.equityCurve} />

            <StrategyDiagnosticsPanel result={result} />

            {mc && mc.trades > 0 && <MonteCarloPanel mc={mc} startingEquity={10_000} />}

            <HourHeatmap result={result} />

            <TradesTable result={result} />
          </div>
        )}
      </div>
    </div>
  )
}


// ─── MonteCarloPanel ────────────────────────────────────────────────

function MonteCarloPanel({ mc, startingEquity }: {
  mc:             MonteCarloResult
  startingEquity: number
}) {
  const profitable = mc.profitable_paths_pct
  const ruin       = mc.ruin_paths_pct
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-amber-300" />
          <h3 className="text-sm font-semibold">Monte Carlo robustness</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            mc.confidence === 'high'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : mc.confidence === 'medium'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
          )}>
            Reliability · {mc.confidence}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {mc.runs} shuffled paths · {mc.trades} trades
          </span>
        </div>
      </div>

      {/* Confidence note — explains the band so users don't act on a
          statistically meaningless distribution. */}
      <p className={cn(
        'mb-3 rounded-md border px-2.5 py-1.5 text-[11px]',
        mc.confidence === 'low'
          ? 'border-rose-500/40 bg-rose-500/[0.05] text-rose-200'
          : 'border-border bg-background/40 text-muted-foreground',
      )}>
        {mc.confidence_note}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <div className={cn(
          'rounded-lg border p-3',
          profitable >= 70 ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200'
          : profitable >= 50 ? 'border-amber-500/40 bg-amber-500/[0.04] text-amber-200'
          : 'border-rose-500/40 bg-rose-500/[0.04] text-rose-200',
        )}>
          <p className="text-[10px] uppercase tracking-wider opacity-80">Profitable paths</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums">{profitable}%</p>
        </div>
        <div className={cn(
          'rounded-lg border p-3',
          ruin <= 5 ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-200'
          : ruin <= 20 ? 'border-amber-500/40 bg-amber-500/[0.04] text-amber-200'
          : 'border-rose-500/40 bg-rose-500/[0.04] text-rose-200',
        )}>
          <p className="text-[10px] uppercase tracking-wider opacity-80">Paths with ≥20% DD</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums">{ruin}%</p>
        </div>
      </div>

      <PctTable
        label="Final P&L"
        rows={[
          ['p05', mc.final_pnl.p05], ['p25', mc.final_pnl.p25],
          ['median', mc.final_pnl.p50],
          ['p75', mc.final_pnl.p75], ['p95', mc.final_pnl.p95],
        ]}
        format={(v) => `${v >= 0 ? '+' : ''}$${Math.round(v).toLocaleString()}`}
      />
      <PctTable
        label="Max DD (USD)"
        rows={[
          ['p05', mc.max_drawdown_usd.p05], ['p25', mc.max_drawdown_usd.p25],
          ['median', mc.max_drawdown_usd.p50],
          ['p75', mc.max_drawdown_usd.p75], ['p95', mc.max_drawdown_usd.p95],
        ]}
        format={(v) => `-$${Math.round(v).toLocaleString()}`}
      />
      <PctTable
        label="Max DD (%)"
        rows={[
          ['p05', mc.max_drawdown_pct.p05], ['p25', mc.max_drawdown_pct.p25],
          ['median', mc.max_drawdown_pct.p50],
          ['p75', mc.max_drawdown_pct.p75], ['p95', mc.max_drawdown_pct.p95],
        ]}
        format={(v) => `${(v * 100).toFixed(1)}%`}
      />

      <p className="mt-2 text-[10px] text-muted-foreground/80">
        Shuffles the realised trade sequence — measures path-dependent risk only. Does NOT perturb the strategy itself.
        Starting equity: ${startingEquity.toLocaleString()}.
      </p>
    </div>
  )
}


function PctTable({ label, rows, format }: {
  label: string
  rows: Array<[string, number]>
  format: (v: number) => string
}) {
  return (
    <div className="mt-2 grid grid-cols-5 gap-1.5 text-[11px]">
      <p className="col-span-5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      {rows.map(([k, v]) => (
        <div key={k} className="rounded border border-border/60 bg-background/40 p-1.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{k}</p>
          <p className="mt-0.5 tabular-nums font-semibold">{format(v)}</p>
        </div>
      ))}
    </div>
  )
}


// ─── HourHeatmap ────────────────────────────────────────────────────
// 24-hour UTC heatmap of cumulative P&L per entry hour. Surfaces the
// session-quality axis from the existing strategy-grader without needing
// a separate computation path — reads `result.trades` directly.

function HourHeatmap({ result }: { result: BacktestResult }) {
  if (result.trades.length < 4) return null

  // Bucket trades by entry-hour (UTC).
  const buckets: Array<{ pnl: number; count: number; wins: number }> = Array.from(
    { length: 24 }, () => ({ pnl: 0, count: 0, wins: 0 }),
  )
  for (const t of result.trades) {
    const h = new Date(t.entryTime * 1000).getUTCHours()
    const b = buckets[h]
    if (!b) continue
    b.pnl += t.pnl
    b.count += 1
    if (t.pnl > 0) b.wins += 1
  }

  const maxAbs = Math.max(1, ...buckets.map((b) => Math.abs(b.pnl)))

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">P&L by entry hour (UTC)</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {result.trades.length} trades · 24h buckets
        </span>
      </div>
      <div className="grid grid-cols-12 gap-1.5">
        {buckets.map((b, h) => (
          <HeatmapCell
            key={h}
            hour={h}
            pnl={b.pnl}
            count={b.count}
            wins={b.wins}
            maxAbs={maxAbs}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/80">
        Each cell: P&L · trade count · win rate. Hours with no trades render as &quot;—&quot;.
      </p>
    </div>
  )
}


/**
 * One cell of the hour-of-day heatmap. Encapsulates the dynamic
 * background style so the lint disable lives in exactly one place —
 * the rest of the file stays inline-style-free.
 */
function HeatmapCell({ hour, pnl, count, wins, maxAbs }: {
  hour: number; pnl: number; count: number; wins: number; maxAbs: number
}) {
  const empty     = count === 0
  const positive  = pnl >= 0
  const intensity = Math.min(1, Math.abs(pnl) / maxAbs)
  const tone = empty
    ? 'border-border bg-background/30 text-muted-foreground/40'
    : positive
      ? 'border-emerald-500/40 text-emerald-200'
      : 'border-rose-500/40 text-rose-200'

  // Tailwind can't express dynamic rgba opacity — inline style is the
  // only honest path. Mirrors the ProgressBar pattern used elsewhere.
  /* stylelint-disable-next-line declaration-property-value-disallowed-list */
  // eslint-disable-next-line react/forbid-dom-props
  const fillStyle: React.CSSProperties | undefined = empty
    ? undefined
    : {
        backgroundColor: positive
          ? `rgba(52, 211, 153, ${0.06 + intensity * 0.32})`
          : `rgba(251, 113, 133, ${0.06 + intensity * 0.32})`,
      }

  return (
    <div
      className={cn('rounded border p-1.5 text-center', tone)}
      // eslint-disable-next-line react/forbid-dom-props
      style={fillStyle}
    >
      <p className="text-[9px] uppercase tracking-wider opacity-70">
        {hour.toString().padStart(2, '0')}h
      </p>
      <p className="mt-0.5 text-[10px] font-semibold tabular-nums">
        {empty ? '—' : `${pnl >= 0 ? '+' : ''}$${Math.round(pnl)}`}
      </p>
      {!empty && (
        <p className="text-[9px] opacity-70 tabular-nums">
          {count} · {Math.round((wins / count) * 100)}%
        </p>
      )}
    </div>
  )
}


// ─── TradesTable (unchanged from prior version) ─────────────────────

function TradesTable({ result }: { result: BacktestResult }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <p className="px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground border-b border-border">
        Last 12 trades
      </p>
      <ul className="space-y-2 p-3 md:hidden">
        {result.trades.slice(-12).reverse().map((t, i) => (
          <li key={i} className="rounded-lg border border-border/60 bg-background/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-bold',
                  t.direction === 'long' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                )}>
                  {t.direction.toUpperCase()}
                </span>
                {t.result === 'win'
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400" strokeWidth={2} aria-label="win" />
                  : <XCircle      className="h-4 w-4 text-rose-400"    strokeWidth={2} aria-label="loss" />}
              </span>
              <span className={cn(
                'tabular-nums text-sm font-semibold',
                t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}>
                {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground tabular-nums">
              <span>Entry {t.entry.toFixed(2)}</span>
              <span>Exit {t.exit.toFixed(2)}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <table className="w-full text-xs">
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
                  {t.result === 'win'
                    ? <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" strokeWidth={2} aria-label="win" />
                    : <XCircle      className="ml-auto h-4 w-4 text-rose-400"    strokeWidth={2} aria-label="loss" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ─── Small helpers ──────────────────────────────────────────────────

function ModeButton({ active, onClick, label, disabled }: {
  active: boolean; onClick: () => void; label: string; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
        active ? 'bg-amber-500/15 text-amber-300' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {label}
    </button>
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
        onChange={(e) => onChange(+e.target.value)}
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
  const eqs = curve.map((c) => c.equity)
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
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Equity curve</p>
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
