'use client'

/**
 * OptimizationClient — parameter sweep + edge-stability scorer.
 *
 * Picks one saved strategy, one numeric param within one of its blocks,
 * runs `executeStrategy` for each value in a user-defined range, plots
 * the chosen metric as a column chart, and reports an edge-stability
 * score derived from the coefficient of variation of the metric across
 * the sweep.
 *
 * Why CV-based stability: a sharp single-peak optimum is the classic
 * overfit signal — the metric collapses for nearby param values. A flat
 * or broadly elevated profile means the edge survives perturbations.
 *
 * Compute model: pure client. No new API. The same executor that powers
 * /backtest runs here; we just call it N times across the grid. To keep
 * the browser responsive on large sweeps we yield to the event loop
 * every step via `requestAnimationFrame`.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles, FlaskConical, Play, Activity, Database, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { syntheticBars, type Bar } from '@/lib/backtest'
import { executeStrategy } from '@/lib/strategies/executor'
import {
  BLOCK_CATALOG, type StrategyConfig, type BlockInstance, type BlockParam,
} from '@/lib/strategies/blocks'

// Mirrors BacktestClient's curated symbol set — the same provider
// surface (TwelveData for FX/metals, Coinbase for crypto) backs both.
// Kept inline rather than extracted: a third consumer would justify
// the shared module, two does not.
const HISTORICAL_SYMBOLS: { value: string; label: string; group: string }[] = [
  { group: 'Forex',  value: 'EURUSD',  label: 'EUR/USD' },
  { group: 'Forex',  value: 'GBPUSD',  label: 'GBP/USD' },
  { group: 'Forex',  value: 'USDJPY',  label: 'USD/JPY' },
  { group: 'Forex',  value: 'AUDUSD',  label: 'AUD/USD' },
  { group: 'Metals', value: 'XAUUSD',  label: 'Gold (XAU/USD)' },
  { group: 'Crypto', value: 'BTCUSDT', label: 'BTC/USDT' },
  { group: 'Crypto', value: 'ETHUSDT', label: 'ETH/USDT' },
  { group: 'Crypto', value: 'SOLUSDT', label: 'SOL/USDT' },
]

const TIMEFRAMES: { value: string; label: string }[] = [
  { value: '15min', label: '15m' },
  { value: '1h',    label: '1h'  },
  { value: '4h',    label: '4h'  },
  { value: '1day',  label: '1d'  },
]

type DataSource = 'synthetic' | 'historical'


export interface SavedStrategyOption {
  id:      string
  name:    string
  version: number | null
  config:  StrategyConfig | null
}

type Metric = 'profit_factor' | 'net_pnl' | 'sharpe' | 'win_rate' | 'max_drawdown'
const METRICS: { key: Metric; label: string; higherIsBetter: boolean; fmt: (n: number) => string }[] = [
  { key: 'profit_factor', label: 'Profit factor', higherIsBetter: true,  fmt: (n) => Number.isFinite(n) ? n.toFixed(2) : '∞' },
  { key: 'net_pnl',       label: 'Net P&L',       higherIsBetter: true,  fmt: (n) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}` },
  { key: 'sharpe',        label: 'Sharpe',        higherIsBetter: true,  fmt: (n) => Number.isFinite(n) ? n.toFixed(2) : '—' },
  { key: 'win_rate',      label: 'Win rate',      higherIsBetter: true,  fmt: (n) => `${Math.round(n * 100)}%` },
  { key: 'max_drawdown',  label: 'Max drawdown',  higherIsBetter: false, fmt: (n) => `${(n * 100).toFixed(1)}%` },
]

interface SweepPoint {
  paramValue: number
  metric:     number   // raw metric value (oriented per `higherIsBetter` for ranking)
  trades:     number
  netPnl:     number
  winRate:    number
}


export default function OptimizationClient({
  savedStrategies,
}: {
  savedStrategies: SavedStrategyOption[]
}) {
  const [strategyId, setStrategyId] = useState<string>(savedStrategies[0]?.id ?? '')
  const strategy = useMemo(
    () => savedStrategies.find((s) => s.id === strategyId) ?? null,
    [savedStrategies, strategyId],
  )

  // Sweep params we can actually tune: numeric (int/float) params on
  // blocks that the executor evaluates. We resolve them dynamically
  // from the chosen strategy so users can never pick a no-op block.
  const sweepable = useMemo(() => resolveSweepable(strategy?.config ?? null), [strategy])
  const firstChoice = sweepable[0]

  const [blockInstanceId, setBlockInstanceId] = useState<string>(firstChoice?.instanceId ?? '')
  const [paramKey,        setParamKey]        = useState<string>(firstChoice?.paramKey ?? '')

  const choice = useMemo(
    () => sweepable.find((s) => s.instanceId === blockInstanceId && s.paramKey === paramKey)
      ?? sweepable[0]
      ?? null,
    [sweepable, blockInstanceId, paramKey],
  )

  // Reset selection when the strategy changes.
  useEffect(() => {
    if (!firstChoice) {
      setBlockInstanceId(''); setParamKey('')
    } else {
      setBlockInstanceId(firstChoice.instanceId); setParamKey(firstChoice.paramKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId])

  // Sweep range — default to the param's own min..max if defined, else
  // sensible bounds around the default value.
  const [minVal, setMinVal] = useState(choice?.param.min ?? 0)
  const [maxVal, setMaxVal] = useState(choice?.param.max ?? 100)
  const [steps,  setSteps]  = useState(12)
  const [metric, setMetric] = useState<Metric>('profit_factor')

  // Bar source — synthetic (deterministic seed) or historical (real
  // OHLCV via the auth-gated /api/backtest/ohlcv proxy). Historical
  // bars are fetched once before the sweep loop so the engine isn't
  // hit N times.
  const [dataSource, setDataSource] = useState<DataSource>('synthetic')
  const [symbol,     setSymbol]     = useState('BTCUSDT')
  const [timeframe,  setTimeframe]  = useState('1h')
  const [bars, setBars] = useState(500)
  const [seed, setSeed] = useState(42)

  useEffect(() => {
    if (!choice) return
    if (choice.param.min != null) setMinVal(choice.param.min)
    if (choice.param.max != null) setMaxVal(choice.param.max)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockInstanceId, paramKey])

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<SweepPoint[] | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const metricCfg = METRICS.find((m) => m.key === metric)!

  async function runSweep() {
    if (!strategy?.config || !choice) {
      setError('Pick a strategy and a tunable param first.')
      return
    }
    if (steps < 2 || steps > 40) {
      setError('Steps must be between 2 and 40.')
      return
    }
    if (maxVal <= minVal) {
      setError('Max must be greater than Min.')
      return
    }
    setError(null)
    setRunning(true)
    setProgress(0)
    setResults(null)

    // Fetch bars ONCE — every sweep step replays on the same series so
    // metric differences come from the param, not from new bars.
    let baseBars: Bar[]
    if (dataSource === 'historical') {
      const fetched = await fetchHistorical(symbol, timeframe, bars)
      if (!fetched.ok) {
        setError(fetched.error)
        setRunning(false)
        return
      }
      if (fetched.bars.length < 50) {
        setError(`Only ${fetched.bars.length} bars returned; need at least 50 for a sweep.`)
        setRunning(false)
        return
      }
      baseBars = fetched.bars
    } else {
      baseBars = syntheticBars(bars, seed)
    }
    const out: SweepPoint[] = []
    const span = maxVal - minVal
    const isInt = choice.param.kind === 'int'

    for (let i = 0; i < steps; i++) {
      const raw   = minVal + (span * i) / (steps - 1)
      const value = isInt ? Math.round(raw) : Number(raw.toFixed(4))
      const config = overrideParam(strategy.config, choice.instanceId, choice.paramKey, value)
      try {
        const r = executeStrategy(baseBars, config, { startingEquity: 10_000 })
        const m = extractMetric(metric, r)
        out.push({
          paramValue: value,
          metric:     m,
          trades:     r.totalTrades,
          netPnl:     r.netPnl,
          winRate:    r.winRate,
        })
      } catch {
        out.push({ paramValue: value, metric: NaN, trades: 0, netPnl: 0, winRate: 0 })
      }
      setProgress(Math.round(((i + 1) / steps) * 100))
      // Yield to the event loop so the progress bar paints.
      await new Promise<void>((res) => requestAnimationFrame(() => res()))
    }

    setResults(out)
    setRunning(false)
  }

  const summary = useMemo(() => results ? summarize(results, metricCfg.higherIsBetter) : null, [results, metricCfg.higherIsBetter])

  // Empty state when the user has no saved strategies yet.
  if (savedStrategies.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <FlaskConical className="mx-auto h-10 w-10 text-amber-300" strokeWidth={1.5} aria-hidden />
        <h2 className="mt-3 text-lg font-bold">No saved strategies yet</h2>
        <p className="mt-2 text-xs text-muted-foreground max-w-md mx-auto">
          The optimization center sweeps params on YOUR strategies. Build one in
          the <a href="/quant-builder" className="text-amber-300 hover:underline">Quant Builder</a> first, then come back to find its stable edge.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Strategy + sweep config */}
      <section className="rounded-xl border border-border bg-card p-5">
        {/* Bar source — synthetic (deterministic, instant) vs historical
            (real OHLCV via the engine, identical to /backtest). */}
        <div className="mb-4">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Bar source
          </span>
          <div role="radiogroup" aria-label="Bar source" className="inline-flex rounded-lg border border-border bg-background p-1">
            {(['synthetic', 'historical'] as const).map((ds) => (
              <button
                key={ds}
                type="button"
                role="radio"
                // jsx-a11y/aria-proptypes can't statically resolve the
                // dynamic expression; runtime value is always a clean boolean.
                // eslint-disable-next-line jsx-a11y/aria-proptypes
                aria-checked={dataSource === ds}
                onClick={() => setDataSource(ds)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  dataSource === ds
                    ? 'bg-gradient-primary text-black'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {ds === 'synthetic'
                  ? <><FlaskConical className="h-3 w-3" strokeWidth={2} aria-hidden />Synthetic</>
                  : <><Database     className="h-3 w-3" strokeWidth={2} aria-hidden />Historical</>}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground/80">
            {dataSource === 'synthetic'
              ? 'Deterministic random-walk bars (same seed → identical sweep). Fast.'
              : 'Real OHLCV from the engine. Bars are fetched once and reused across every sweep step.'}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Strategy">
            <select
              aria-label="Strategy"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
            >
              {savedStrategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.version != null ? ` · v${s.version}` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Metric">
            <select
              aria-label="Metric"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}{m.higherIsBetter ? ' (max)' : ' (min)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Block to tune">
            <select
              aria-label="Block to tune"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              value={blockInstanceId}
              onChange={(e) => {
                setBlockInstanceId(e.target.value)
                const next = sweepable.find((s) => s.instanceId === e.target.value)
                if (next) setParamKey(next.paramKey)
              }}
              disabled={sweepable.length === 0}
            >
              {sweepable.length === 0 ? (
                <option value="">— no tunable params on this strategy —</option>
              ) : (
                // Distinct blocks (one option per unique block instance).
                Array.from(new Map(sweepable.map((s) => [s.instanceId, s])).values()).map((s) => (
                  <option key={s.instanceId} value={s.instanceId}>{s.blockLabel}</option>
                ))
              )}
            </select>
          </Field>
          <Field label="Param">
            <select
              aria-label="Param"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
              value={paramKey}
              onChange={(e) => setParamKey(e.target.value)}
              disabled={sweepable.length === 0}
            >
              {sweepable
                .filter((s) => s.instanceId === blockInstanceId)
                .map((s) => (
                  <option key={s.paramKey} value={s.paramKey}>{s.param.label}</option>
                ))}
            </select>
          </Field>
          <Field label="Min">
            <input aria-label="Min" type="number" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" value={minVal}
              step={choice?.param.kind === 'int' ? 1 : 0.01}
              onChange={(e) => setMinVal(Number(e.target.value))} />
          </Field>
          <Field label="Max">
            <input aria-label="Max" type="number" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" value={maxVal}
              step={choice?.param.kind === 'int' ? 1 : 0.01}
              onChange={(e) => setMaxVal(Number(e.target.value))} />
          </Field>
          <Field label="Steps">
            <input aria-label="Steps" type="number" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" value={steps} min={2} max={40}
              onChange={(e) => setSteps(Number(e.target.value))} />
          </Field>
          <Field label="Bars per run">
            <input aria-label="Bars per run" type="number" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" value={bars} min={100} max={2000} step={50}
              onChange={(e) => setBars(Number(e.target.value))} />
          </Field>
          {dataSource === 'synthetic' ? (
            <Field label="Random seed">
              <input aria-label="Random seed" type="number" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" value={seed}
                onChange={(e) => setSeed(Number(e.target.value))} />
            </Field>
          ) : (
            <>
              <Field label="Symbol">
                <select
                  aria-label="Symbol"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {HISTORICAL_SYMBOLS.map((s) => (
                    <option key={s.value} value={s.value}>{s.group} · {s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Timeframe">
                <select
                  aria-label="Timeframe"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  {TIMEFRAMES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runSweep}
            disabled={running || sweepable.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-gradient-primary px-4 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
            {running ? `Sweeping… ${progress}%` : 'Run sweep'}
          </button>
          {error && <span className="text-[12px] text-rose-300">{error}</span>}
        </div>
      </section>

      {/* Results */}
      {results && summary && (
        <section className="rounded-xl border border-border bg-card p-5">
          <header className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
            <h2 className="text-sm font-semibold">Edge profile</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {choice?.blockLabel} · {choice?.param.label} · {metricCfg.label}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile
              label="Best value"
              icon={Sparkles}
              value={String(summary.best.paramValue)}
              hint={metricCfg.fmt(summary.best.metric)}
              tone="text-emerald-300"
            />
            <SummaryTile
              label="Worst value"
              icon={Activity}
              value={String(summary.worst.paramValue)}
              hint={metricCfg.fmt(summary.worst.metric)}
              tone="text-rose-300"
            />
            <SummaryTile
              label="Stability"
              icon={Sparkles}
              value={`${summary.stability}/100`}
              hint={
                summary.stability >= 70 ? 'broad plateau'
                : summary.stability >= 40 ? 'mixed'
                : 'sharp peak / overfit risk'
              }
              tone={
                summary.stability >= 70 ? 'text-emerald-300'
                : summary.stability >= 40 ? 'text-amber-300'
                : 'text-rose-300'
              }
            />
            <SummaryTile
              label="Coverage"
              icon={Activity}
              value={`${summary.validCount}/${results.length}`}
              hint="metric defined"
              tone="text-foreground"
            />
          </div>

          <div className="mt-5">
            <SweepChart points={results} metric={metric} cfg={metricCfg} bestVal={summary.best.paramValue} />
          </div>
        </section>
      )}
    </div>
  )
}


// ─── Sub-components ────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  )
}

function SummaryTile({ label, icon: Icon, value, hint, tone }: {
  label: string; icon: LucideIcon; value: string; hint: string; tone: string
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
      </div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums leading-none', tone)}>{value}</div>
      <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>
    </div>
  )
}

function SweepChart({ points, metric, cfg, bestVal }: {
  points: SweepPoint[]; metric: Metric; cfg: typeof METRICS[number]; bestVal: number
}) {
  const finiteVals = points.map((p) => p.metric).filter((v) => Number.isFinite(v))
  if (finiteVals.length === 0) {
    return <p className="text-xs text-muted-foreground">Every sweep point returned an undefined metric — try a wider range or more bars.</p>
  }
  const lo = Math.min(...finiteVals)
  const hi = Math.max(...finiteVals)
  const span = hi - lo || 1
  const w = 540, h = 180, padL = 40, padR = 10, padT = 8, padB = 22
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const barW = innerW / points.length
  void metric

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} role="img" aria-label="Parameter sweep">
        {/* y-axis labels */}
        <text x={padL - 6} y={padT + 8}        textAnchor="end" className="fill-muted-foreground" fontSize="10">{cfg.fmt(hi)}</text>
        <text x={padL - 6} y={padT + innerH}   textAnchor="end" className="fill-muted-foreground" fontSize="10">{cfg.fmt(lo)}</text>
        {/* zero-line if metric crosses it */}
        {lo < 0 && hi > 0 && (() => {
          const zeroY = padT + innerH - ((0 - lo) / span) * innerH
          return <line x1={padL} x2={w - padR} y1={zeroY} y2={zeroY} className="stroke-border" strokeDasharray="3 3" />
        })()}
        {points.map((p, i) => {
          const x = padL + i * barW
          const valid = Number.isFinite(p.metric)
          const v = valid ? p.metric : 0
          const top = padT + innerH - ((v - lo) / span) * innerH
          const baseY = padT + innerH - ((Math.max(lo, 0) - lo) / span) * innerH
          const y = Math.min(top, baseY)
          const height = Math.max(1, Math.abs(top - baseY))
          const isBest = p.paramValue === bestVal && valid
          const cls = !valid
            ? 'fill-muted-foreground/30'
            : isBest
              ? 'fill-emerald-400'
              : (cfg.higherIsBetter ? v >= 0 : v <= 0) ? 'fill-amber-400/70' : 'fill-rose-400/70'
          return (
            <g key={i}>
              <rect x={x + 1} y={y} width={Math.max(1, barW - 2)} height={height} className={cls} />
              {isBest && (
                <text x={x + barW / 2} y={padT + 6} textAnchor="middle" className="fill-emerald-300" fontSize="9" fontWeight="bold">★</text>
              )}
            </g>
          )
        })}
        {/* x-axis: first / mid / last labels */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => {
          const p = points[i]; if (!p) return null
          const x = padL + i * barW + barW / 2
          return (
            <text key={i} x={x} y={h - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              {p.paramValue}
            </text>
          )
        })}
      </svg>
    </div>
  )
}


// ─── Helpers ────────────────────────────────────────────────────────

type FetchResult =
  | { ok: true;  bars: Bar[] }
  | { ok: false; error: string }

/** Fetch real OHLCV via the auth-gated proxy. Same surface as
 *  BacktestClient.fetchHistorical — duplicated here rather than
 *  extracted; if a third consumer appears, lift to a shared lib. */
async function fetchHistorical(symbol: string, interval: string, outputsize: number): Promise<FetchResult> {
  try {
    const qs = new URLSearchParams({ symbol, interval, outputsize: String(outputsize) })
    const res = await fetch(`/api/backtest/ohlcv?${qs.toString()}`, { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.detail || json?.error || `engine HTTP ${res.status}` }
    if (json.error) return { ok: false, error: `engine reported: ${json.error}` }
    const rows: Array<Partial<Bar>> = Array.isArray(json.bars) ? json.bars : []
    if (rows.length === 0) {
      return { ok: false, error: `No historical bars for ${symbol} @ ${interval} — provider may not be configured.` }
    }
    const bars: Bar[] = rows
      .map((b) => ({
        time:  Number(b.time),
        open:  Number(b.open),
        high:  Number(b.high),
        low:   Number(b.low),
        close: Number(b.close),
      }))
      .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
    return { ok: true, bars }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' }
  }
}


interface SweepableEntry {
  instanceId: string
  blockKey:   string
  blockLabel: string
  paramKey:   string
  param:      BlockParam
}

/** A param is sweepable when it's numeric AND the block is one the
 *  executor actually evaluates (LIVE blocks). */
const LIVE_BLOCKS = new Set([
  'ema_alignment', 'rsi_band', 'macd_cross', 'bollinger_position',
  'atr_band', 'session_window', 'swing_break', 'engulfing_candle',
  'liquidity_sweep', 'order_block_tap', 'fair_value_gap',
  'fixed_risk_per_trade', 'daily_loss_cap',
])

function resolveSweepable(config: StrategyConfig | null): SweepableEntry[] {
  if (!config) return []
  const out: SweepableEntry[] = []
  for (const b of config.blocks) {
    if (!LIVE_BLOCKS.has(b.key)) continue
    const def = BLOCK_CATALOG.find((d) => d.key === b.key)
    if (!def) continue
    for (const p of def.params) {
      if (p.kind === 'int' || p.kind === 'float') {
        out.push({
          instanceId: b.id,
          blockKey:   b.key,
          blockLabel: def.label,
          paramKey:   p.key,
          param:      p,
        })
      }
    }
  }
  return out
}

function overrideParam(
  config: StrategyConfig,
  instanceId: string,
  paramKey: string,
  value: number,
): StrategyConfig {
  const blocks: BlockInstance[] = config.blocks.map((b) => {
    if (b.id !== instanceId) return b
    return { ...b, params: { ...b.params, [paramKey]: value } }
  })
  return { ...config, blocks }
}

function extractMetric(metric: Metric, r: ReturnType<typeof executeStrategy>): number {
  switch (metric) {
    case 'profit_factor': return r.profitFactor
    case 'net_pnl':       return r.netPnl
    case 'sharpe':        return r.sharpe ?? NaN
    case 'win_rate':      return r.winRate
    case 'max_drawdown':  return r.maxDrawdownPct
  }
}

interface SweepSummary {
  best:        SweepPoint
  worst:       SweepPoint
  stability:   number   // 0-100
  validCount:  number
}

function summarize(points: SweepPoint[], higherIsBetter: boolean): SweepSummary {
  const valid = points.filter((p) => Number.isFinite(p.metric))
  const validCount = valid.length
  if (validCount === 0) {
    return { best: points[0]!, worst: points[0]!, stability: 0, validCount: 0 }
  }
  const sorted = [...valid].sort((a, b) => higherIsBetter ? b.metric - a.metric : a.metric - b.metric)
  const best  = sorted[0]!
  const worst = sorted[sorted.length - 1]!

  // Stability = inverted coefficient of variation across the sweep.
  // CV = stddev / |mean|. Low CV → flat plateau → high stability score.
  const mean = valid.reduce((s, p) => s + p.metric, 0) / validCount
  const variance = valid.reduce((s, p) => s + (p.metric - mean) ** 2, 0) / validCount
  const stddev = Math.sqrt(variance)
  const cv = Math.abs(mean) < 1e-9 ? Infinity : stddev / Math.abs(mean)
  // Map CV in [0, 1.5] → stability in [100, 0]. Above CV=1.5 → 0.
  const stability = Math.max(0, Math.min(100, Math.round(100 - (cv / 1.5) * 100)))

  return { best, worst, stability, validCount }
}
