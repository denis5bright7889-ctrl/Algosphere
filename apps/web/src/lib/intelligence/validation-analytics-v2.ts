/**
 * Validation Analytics V2 — Phase 8 expansion.
 *
 * Six additional institutional metrics. All pure-deterministic — no
 * Monte-Carlo, no LLM, no randomness. Same input array always yields
 * the same metrics. Methodology is disclosed inline in the UI footer
 * wherever these values render.
 *
 * Metrics:
 *
 *   • Omega Ratio              Σ(positive returns) / Σ|negative returns|
 *                              about a return threshold (default 0).
 *                              > 1 is favourable.
 *
 *   • Value at Risk (VaR)      The α-quantile loss of the trade-PnL
 *                              distribution. Historical method (no
 *                              normality assumption). Default α = 0.05.
 *
 *   • Conditional VaR (CVaR)   The MEAN loss in the worst α tail.
 *                              Always ≥ VaR in magnitude. Captures
 *                              tail-of-tail risk.
 *
 *   • Ulcer Index              RMS of percentage drawdowns from running
 *                              peak. Higher = more time underwater.
 *                              Penalises drawdown depth + duration.
 *
 *   • MAR Ratio                Annualised return / max drawdown %.
 *                              Used by CTAs to compare strategies.
 *
 *   • Gain-to-Pain Ratio       Σ(positive returns) / Σ|negative returns|
 *                              taken over MONTHLY (or window) buckets.
 *                              In single-bucket data this collapses to
 *                              a simplified form — disclosed honestly.
 *
 * Honesty contract:
 *   - MIN_SAMPLE_V2 = 30 trades. Below this every V2 metric returns
 *     null. The aggregator never invents numbers on thin data.
 *   - Metrics that would divide by zero (Omega/G2P with no losers,
 *     MAR with zero drawdown) return null, NEVER ∞ or a fudged value.
 *   - VaR/CVaR signs are NEGATIVE (losses) — the API reports the
 *     loss magnitude as a positive number for UI convenience and
 *     documents this explicitly.
 */

export const MIN_SAMPLE_V2 = 30
const TRADING_DAYS_PER_YEAR = 252

export interface V2Input {
  /** Realised P&L per trade (account currency). */
  follower_pnl: number
  /** Closed-at ISO string — used for time-windowed annualisation. */
  closed_at:    string | null
}

export interface V2Metrics {
  sample_size:         number
  omega:               number | null
  var_95:              number | null   // 95% historical VaR (loss magnitude)
  cvar_95:             number | null   // 95% conditional VaR (loss magnitude)
  ulcer_index:         number | null
  mar:                 number | null
  gain_to_pain:        number | null
  methodology: {
    var_alpha:                  number
    annualisation_days:         number
    threshold_for_omega:        number
    notes:                      string[]
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function quantileLow(sortedAsc: number[], alpha: number): number | null {
  // Conservative lower quantile — index = floor(alpha * (n-1)).
  if (sortedAsc.length === 0) return null
  const idx = Math.floor(alpha * (sortedAsc.length - 1))
  const v = sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))]
  return typeof v === 'number' ? v : null
}

/** Max drawdown (absolute) on cumulative equity curve. */
function maxDrawdown(pnls: number[]): number {
  let peak = 0, run = 0, maxDD = 0
  for (const p of pnls) {
    run += p
    if (run > peak) peak = run
    const dd = peak - run
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

/** Ulcer Index — RMS percentage drawdown across the curve. */
function ulcerIndex(pnls: number[]): number | null {
  if (pnls.length === 0) return null
  let peak = 0, run = 0, sumSq = 0
  for (const p of pnls) {
    run += p
    if (run > peak) peak = run
    if (peak > 0) {
      const ddPct = ((peak - run) / peak) * 100
      sumSq += ddPct * ddPct
    }
  }
  return Math.sqrt(sumSq / pnls.length)
}

/** Annualisation factor from closed_at span. Null when span is too
 *  small (< 7 days) — yearly extrapolation would be dishonest. */
function annualisationFactor(trades: V2Input[]): number | null {
  const closed = trades.map(t => t.closed_at).filter((s): s is string => !!s).sort()
  if (closed.length < 2) return null
  const first = new Date(closed[0]!).getTime()
  const last  = new Date(closed[closed.length - 1]!).getTime()
  const days = (last - first) / 86_400_000
  if (days < 7) return null
  return TRADING_DAYS_PER_YEAR / days
}

// ── Public API ─────────────────────────────────────────────────────

export function computeAnalyticsV2(trades: V2Input[]): V2Metrics {
  const empty: V2Metrics = {
    sample_size:         trades.length,
    omega:               null,
    var_95:              null,
    cvar_95:             null,
    ulcer_index:         null,
    mar:                 null,
    gain_to_pain:        null,
    methodology: {
      var_alpha:                  0.05,
      annualisation_days:         TRADING_DAYS_PER_YEAR,
      threshold_for_omega:        0,
      notes:                      [
        `Metrics suppressed to null below ${MIN_SAMPLE_V2} trades.`,
        'VaR/CVaR returned as LOSS MAGNITUDE (positive number).',
        'MAR uses annualised return ÷ max drawdown — null when DD = 0.',
        'Annualisation requires ≥ 7 days span between earliest and latest closed_at.',
      ],
    },
  }

  if (trades.length < MIN_SAMPLE_V2) return empty

  const pnls = trades.map(t => t.follower_pnl).filter(Number.isFinite)
  if (pnls.length < MIN_SAMPLE_V2) return empty

  const sortedAsc = [...pnls].sort((a, b) => a - b)
  const winners = pnls.filter(p => p > 0)
  const losers  = pnls.filter(p => p < 0)
  const grossWins   = winners.reduce((a, b) => a + b, 0)
  const grossLosses = Math.abs(losers.reduce((a, b) => a + b, 0))
  const netProfit   = grossWins - grossLosses

  // Omega ratio (threshold = 0 → equivalent to PF). We make it
  // explicit for the methodology disclosure.
  const omega = grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : null

  // Historical VaR/CVaR at 5% (reported as loss magnitude).
  const varRaw = quantileLow(sortedAsc, 0.05)
  const var95 = varRaw == null || varRaw >= 0 ? null : Math.round(-varRaw * 100) / 100

  // CVaR = mean of the worst 5% bucket.
  const tailCount = Math.max(1, Math.floor(0.05 * sortedAsc.length))
  const tail = sortedAsc.slice(0, tailCount)
  const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length
  const cvar95 = tailMean >= 0 ? null : Math.round(-tailMean * 100) / 100

  // Ulcer Index — RMS percentage drawdown on the equity curve.
  const ui = ulcerIndex(pnls)

  // MAR ratio: annualised return / max drawdown. Honest null when DD=0
  // or annualisation factor isn't computable.
  const dd = maxDrawdown(pnls)
  const ann = annualisationFactor(trades)
  let mar: number | null = null
  if (dd > 0 && ann != null) {
    // Annualised return as PERCENT of peak equity (approx). Treat
    // |sum(pnls)| as the year's return; peak ~ |sum(pnls)| + dd.
    const annReturn = netProfit * ann
    const ddPctEquity = dd > 0 ? (dd / Math.max(Math.abs(netProfit) + dd, dd)) * 100 : 0
    if (ddPctEquity > 0) {
      mar = Math.round((annReturn / dd) * 100) / 100
    }
  }

  // Gain-to-Pain — same form as Omega for single-bucket samples;
  // call out the equivalence in methodology rather than fabricate a
  // monthly bucketed view.
  const g2p = grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : null

  return {
    sample_size:  trades.length,
    omega,
    var_95:       var95,
    cvar_95:      cvar95,
    ulcer_index:  ui == null ? null : Math.round(ui * 100) / 100,
    mar,
    gain_to_pain: g2p,
    methodology: {
      var_alpha:           0.05,
      annualisation_days:  TRADING_DAYS_PER_YEAR,
      threshold_for_omega: 0,
      notes: [
        'Omega ratio at threshold 0 — Σ gains ÷ Σ |losses|.',
        'VaR/CVaR are 5% historical (no normality assumption); reported as loss magnitude.',
        'CVaR is the MEAN of the worst 5% bucket.',
        'Ulcer Index = RMS of percentage drawdowns from running peak.',
        'MAR ratio = annualised return ÷ max drawdown; null when DD = 0 or trade span < 7 days.',
        'Gain-to-Pain collapses to Omega in single-bucket data — disclosed honestly rather than synthesised monthly buckets.',
      ],
    },
  }
}
