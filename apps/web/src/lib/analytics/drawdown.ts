/**
 * Canonical Account Drawdown Engine (Phase 10A) — THE single source of truth.
 *
 * Every surface that shows account drawdown (overview, risk, analytics,
 * intelligence/me) computes it HERE. Previously two paths disagreed:
 *   • analyzePerformance(entries, accountEquity)  → equity-relative
 *   • computeDrawdownCurve(series)                → PnL-relative (no equity)
 * Same trader, different Max DD. This module removes that fork.
 *
 * Definition: peak-to-trough decline of the equity curve
 *   equity_t = starting_balance + Σ pnl_{≤t}
 *   starting_balance = accountEquity − Σ pnl  (when equity known), else 0
 *   drawdown% = (peak − equity) / peak, clamped to [0,1]
 *
 * Baked-in trust guards:
 *   B2 — a single outlier pnl (typo / bad poll) is CLAMPED so it cannot
 *        permanently inflate the running peak.
 *   B5 — when the account-equity reading is older than the freshness budget,
 *        status = 'stale' and the equity anchor is NOT trusted (falls back to
 *        PnL-relative) — never a confident number off stale equity.
 *
 * Pure + self-contained (no imports) → node-testable.
 */

export type DrawdownStatus = 'ok' | 'pnl_relative' | 'stale' | 'insufficient'

export interface AccountDrawdown {
  max_drawdown_pct:  number          // 0..1 magnitude
  max_drawdown_usd:  number
  peak_equity:       number
  starting_balance:  number
  status:            DrawdownStatus
  outliers_clamped:  number
}

export interface DrawdownOpts {
  /** Current broker/account equity. When known + fresh → equity-relative. */
  accountEquity?:      number | null
  /** Age of that equity reading, seconds (now − equity_updated_at). B5. */
  equityAgeSeconds?:   number | null
  /** Freshness budget; older → 'stale'. Default 1800s (30m). */
  maxEquityAgeSeconds?: number
  /** B2 outlier guard on/off. Default true. */
  outlierGuard?:       boolean
  /** A pnl is clamped if |pnl| exceeds this × p90(|pnl|). Default 8 (egregious only). */
  spikeMultiple?:      number
}

function p90Abs(series: number[]): number {
  const abs = series.map((x) => Math.abs(x)).filter((x) => x > 0).sort((a, b) => a - b)
  if (abs.length === 0) return 0
  const idx = Math.min(abs.length - 1, Math.floor(abs.length * 0.9))
  return abs[idx]!
}

/** Clamp egregious outliers (B2) so one bad value can't inflate the peak. */
function guardOutliers(series: number[], spikeMultiple: number): { clean: number[]; clamped: number } {
  const scale = p90Abs(series)
  if (scale <= 0) return { clean: series, clamped: 0 }
  const cap = scale * spikeMultiple
  let clamped = 0
  const clean = series.map((p) => {
    if (Math.abs(p) > cap) { clamped++; return Math.sign(p) * cap }
    return p
  })
  return { clean, clamped }
}

export function computeAccountDrawdown(pnlSeries: number[], opts: DrawdownOpts = {}): AccountDrawdown {
  const maxAge       = opts.maxEquityAgeSeconds ?? 1800
  const spikeMul     = opts.spikeMultiple ?? 8
  const guard        = opts.outlierGuard !== false

  if (pnlSeries.length === 0) {
    return { max_drawdown_pct: 0, max_drawdown_usd: 0, peak_equity: 0, starting_balance: 0,
      status: 'insufficient', outliers_clamped: 0 }
  }

  const { clean, clamped } = guard ? guardOutliers(pnlSeries, spikeMul) : { clean: pnlSeries, clamped: 0 }

  // B5: a stale equity reading is not trusted as the anchor.
  const stale = opts.equityAgeSeconds != null && Number.isFinite(opts.equityAgeSeconds) && opts.equityAgeSeconds > maxAge
  const equityKnown = opts.accountEquity != null && Number.isFinite(opts.accountEquity) && opts.accountEquity > 0 && !stale

  const netPnl = clean.reduce((s, p) => s + p, 0)
  const startingBalance = equityKnown ? Math.max(0, (opts.accountEquity as number) - netPnl) : 0

  let equity = startingBalance
  let peak = startingBalance
  let maxPct = 0
  let maxUsd = 0
  for (const pnl of clean) {
    equity += pnl
    if (equity > peak) peak = equity
    const ddUsd = peak - equity
    const ddPct = peak > 0 ? Math.min(ddUsd / peak, 1) : (ddUsd > 0 ? 1 : 0)
    if (ddUsd > maxUsd) maxUsd = ddUsd
    if (ddPct > maxPct) maxPct = ddPct
  }

  const status: DrawdownStatus = stale ? 'stale' : equityKnown ? 'ok' : 'pnl_relative'
  return {
    max_drawdown_pct: maxPct,
    max_drawdown_usd: maxUsd,
    peak_equity:      peak,
    starting_balance: startingBalance,
    status,
    outliers_clamped: clamped,
  }
}

export interface DrawdownStep { equity: number; drawdown_pct: number }   // drawdown_pct: negative magnitude, 0..-100

/** Per-step curve, using the SAME math as computeAccountDrawdown. */
export function drawdownCurve(pnlSeries: number[], opts: DrawdownOpts = {}): DrawdownStep[] {
  const spikeMul = opts.spikeMultiple ?? 8
  const guard    = opts.outlierGuard !== false
  const { clean } = guard ? guardOutliers(pnlSeries, spikeMul) : { clean: pnlSeries }
  const summary  = computeAccountDrawdown(pnlSeries, opts)
  let equity = summary.starting_balance
  let peak = summary.starting_balance
  return clean.map((pnl) => {
    equity += pnl
    if (equity > peak) peak = equity
    const ddUsd = peak - equity
    const mag = peak > 0 ? Math.min(ddUsd / peak, 1) : (ddUsd > 0 ? 1 : 0)
    return { equity: Math.round(equity * 100) / 100, drawdown_pct: Math.round(-mag * 100 * 100) / 100 }
  })
}
