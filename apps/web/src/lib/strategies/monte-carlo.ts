/**
 * Monte Carlo trade-shuffle robustness (Refocus R5c).
 *
 * Takes a BacktestResult and replays the trade sequence in N random
 * orderings to estimate confidence intervals on max-DD, final P&L,
 * and the share of paths that finish profitable.
 *
 * Trade-shuffle MC is the right tool for "did this edge depend on the
 * lucky ordering of wins and losses?" — it does NOT bootstrap returns
 * or perturb price paths. For that the user wants a forward-walk; this
 * function is honest about what it measures.
 */
import type { BacktestResult } from '@/lib/backtest'


export interface MonteCarloOptions {
  runs?:           number          // default 1000
  startingEquity:  number
  /** Deterministic seed for reproducibility; default = Date.now() */
  seed?:           number
}


export interface MonteCarloResult {
  runs:             number
  trades:           number
  /** Confidence intervals on key statistics. */
  final_pnl: {
    p05: number; p25: number; p50: number; p75: number; p95: number
    mean: number
  }
  max_drawdown_usd: {
    p05: number; p25: number; p50: number; p75: number; p95: number
    mean: number
  }
  max_drawdown_pct: {
    p05: number; p25: number; p50: number; p75: number; p95: number
    mean: number
  }
  /** Share of shuffled paths whose final equity is above starting. */
  profitable_paths_pct: number
  /** Share of paths whose intraday drawdown exceeds 20%. */
  ruin_paths_pct: number
}


/** Seeded mulberry32 PRNG — deterministic across runs given the same seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = a[i]!; a[i] = a[j]!; a[j] = t
  }
  return a
}


function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))
  return sorted[idx]!
}


export function runMonteCarlo(
  result: BacktestResult,
  opts:   MonteCarloOptions,
): MonteCarloResult {
  const runs   = opts.runs ?? 1000
  const seed   = opts.seed ?? Date.now()
  const trades = result.trades.map((t) => t.pnl)
  const rand   = mulberry32(seed)

  if (trades.length === 0) {
    return {
      runs: 0, trades: 0,
      final_pnl:        zero(),
      max_drawdown_usd: zero(),
      max_drawdown_pct: zero(),
      profitable_paths_pct: 0, ruin_paths_pct: 0,
    }
  }

  const finalPnls:  number[] = []
  const maxDdUsds:  number[] = []
  const maxDdPcts:  number[] = []
  let   profitablePaths = 0
  let   ruinPaths       = 0
  const RUIN_PCT = 0.20

  for (let r = 0; r < runs; r++) {
    const order = shuffle(trades, rand)
    let equity  = opts.startingEquity
    let peak    = equity
    let maxDd   = 0
    for (const pnl of order) {
      equity += pnl
      if (equity > peak) peak = equity
      const dd = peak - equity
      if (dd > maxDd) maxDd = dd
    }
    const finalPnl = equity - opts.startingEquity
    const maxDdPct = peak > 0 ? maxDd / peak : 0
    finalPnls.push(finalPnl)
    maxDdUsds.push(maxDd)
    maxDdPcts.push(maxDdPct)
    if (finalPnl > 0) profitablePaths++
    if (maxDdPct >= RUIN_PCT) ruinPaths++
  }

  finalPnls.sort((a, b) => a - b)
  maxDdUsds.sort((a, b) => a - b)
  maxDdPcts.sort((a, b) => a - b)

  return {
    runs, trades: trades.length,
    final_pnl: summarize(finalPnls),
    max_drawdown_usd: summarize(maxDdUsds),
    max_drawdown_pct: summarize(maxDdPcts),
    profitable_paths_pct: Math.round((profitablePaths / runs) * 1000) / 10,
    ruin_paths_pct:       Math.round((ruinPaths       / runs) * 1000) / 10,
  }
}


function summarize(sorted: number[]) {
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
  return {
    p05: pctile(sorted, 0.05),
    p25: pctile(sorted, 0.25),
    p50: pctile(sorted, 0.50),
    p75: pctile(sorted, 0.75),
    p95: pctile(sorted, 0.95),
    mean,
  }
}

function zero() {
  return { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 }
}
