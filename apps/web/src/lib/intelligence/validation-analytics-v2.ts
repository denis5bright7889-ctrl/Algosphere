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
  /** Optional slippage_pct for execution-alpha. */
  slippage_pct?: number | null
  /** Optional broker for broker-alpha. */
  broker?:      string | null
  /** Optional symbol for risk-concentration. */
  symbol?:      string | null
  /** Optional lot size for risk-concentration. */
  lot_size?:    number | null
}

export interface V2Metrics {
  sample_size:         number
  omega:               number | null
  var_95:              number | null   // 95% historical VaR (loss magnitude)
  cvar_95:             number | null   // 95% conditional VaR (loss magnitude)
  ulcer_index:         number | null
  mar:                 number | null
  gain_to_pain:        number | null
  // V2 expansion (the 9 additional metrics the spec named)
  tail_risk_pct:       number | null   // worst 1% loss as % of mean trade
  strategy_decay:      number | null   // recent-half PF / older-half PF (<1 = decay)
  regime_stability:    number | null   // 0-100 (stddev of windowed returns ÷ mean abs)
  ci_95_lower:         number | null   // 95% CI lower bound on mean return per trade
  ci_95_upper:         number | null   // upper bound
  forward_test_reliability: number | null   // 0-100 (consistency between halves)
  validation_confidence_score: number | null  // 0-100 (composite of sample + CI tightness + stability)
  execution_alpha:     number | null   // null — requires slippage_pct on input; computed when present
  broker_alpha:        number | null   // null — requires broker_id on input
  risk_concentration:  number | null   // 0-100 Herfindahl of position size by symbol (when known)
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
    tail_risk_pct:       null,
    strategy_decay:      null,
    regime_stability:    null,
    ci_95_lower:         null,
    ci_95_upper:         null,
    forward_test_reliability:    null,
    validation_confidence_score: null,
    execution_alpha:     null,
    broker_alpha:        null,
    risk_concentration:  null,
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

  // ── V2-expansion metrics ────────────────────────────────────────
  const mu = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const variance = pnls.reduce((a, b) => a + (b - mu) ** 2, 0) / (pnls.length - 1)
  const sd = Math.sqrt(variance)

  // Tail Risk — worst 1% loss / mean abs trade (×100 → %)
  const tail1Count = Math.max(1, Math.floor(0.01 * sortedAsc.length))
  const tail1Mean  = sortedAsc.slice(0, tail1Count).reduce((a, b) => a + b, 0) / tail1Count
  const meanAbs    = pnls.reduce((a, b) => a + Math.abs(b), 0) / pnls.length
  const tailRisk   = meanAbs > 0
    ? Math.round((Math.abs(tail1Mean) / meanAbs) * 100 * 100) / 100
    : null

  // Strategy Decay — recent-half PF / older-half PF. <1 = decay.
  const closedSorted = trades
    .filter(t => t.closed_at)
    .sort((a, b) => (a.closed_at ?? '').localeCompare(b.closed_at ?? ''))
  let decay: number | null = null
  if (closedSorted.length >= 20) {
    const mid = Math.floor(closedSorted.length / 2)
    const older = closedSorted.slice(0, mid).map(t => t.follower_pnl)
    const newer = closedSorted.slice(mid).map(t => t.follower_pnl)
    const pfOf = (arr: number[]) => {
      const w = arr.filter(p => p > 0).reduce((a, b) => a + b, 0)
      const l = Math.abs(arr.filter(p => p < 0).reduce((a, b) => a + b, 0))
      return l > 0 ? w / l : null
    }
    const pfOld = pfOf(older)
    const pfNew = pfOf(newer)
    if (pfOld != null && pfNew != null && pfOld > 0) {
      decay = Math.round((pfNew / pfOld) * 100) / 100
    }
  }

  // Regime Stability — 1 - (sd of rolling-window means / overall mean abs).
  // Windowed at trades.length / 5. Lower stability = noisier regime.
  let regimeStability: number | null = null
  if (pnls.length >= 25) {
    const win = Math.max(5, Math.floor(pnls.length / 5))
    const windowMeans: number[] = []
    for (let i = 0; i + win <= pnls.length; i++) {
      const slice = pnls.slice(i, i + win)
      windowMeans.push(slice.reduce((a, b) => a + b, 0) / win)
    }
    if (windowMeans.length >= 3) {
      const wMu = windowMeans.reduce((a, b) => a + b, 0) / windowMeans.length
      const wSd = Math.sqrt(windowMeans.reduce((a, b) => a + (b - wMu) ** 2, 0) / (windowMeans.length - 1))
      const denom = Math.abs(wMu) + wSd
      regimeStability = denom > 0
        ? Math.round(Math.max(0, Math.min(1, 1 - wSd / denom)) * 100)
        : null
    }
  }

  // 95% Confidence interval on mean return per trade (t-approx → ±1.96σ/√n)
  const se = sd / Math.sqrt(pnls.length)
  const ciLow  = Math.round((mu - 1.96 * se) * 100) / 100
  const ciHigh = Math.round((mu + 1.96 * se) * 100) / 100

  // Forward-test reliability — consistency between halves.
  // 100 = identical PF; 0 = wildly divergent.
  let forwardReliability: number | null = null
  if (decay != null) {
    // Map decay to 0-100: decay==1 → 100, decay≤0 or ≥2 → 0
    const distance = Math.abs(decay - 1)
    forwardReliability = Math.round(Math.max(0, Math.min(1, 1 - distance)) * 100)
  }

  // Validation confidence score — composite of sample + CI tightness +
  // regime stability. Each term 0-1, weighted 40/30/30.
  const sampleTerm = Math.min(1, pnls.length / 100)
  const ciTightness = Math.abs(mu) > 0
    ? Math.max(0, Math.min(1, 1 - (ciHigh - ciLow) / (Math.abs(mu) * 4)))
    : 0
  const stabTerm = (regimeStability ?? 0) / 100
  const valConf = Math.round((sampleTerm * 0.4 + ciTightness * 0.3 + stabTerm * 0.3) * 100)

  // Execution alpha — null unless slippage_pct present on inputs.
  // "Alpha" here: realised pnl vs theoretical-no-slippage pnl.
  let executionAlpha: number | null = null
  const slipRows = trades.filter(t => typeof t.slippage_pct === 'number')
  if (slipRows.length >= MIN_SAMPLE_V2 / 2) {
    const avgSlipBps = (slipRows.reduce((s, t) => s + Math.abs(t.slippage_pct as number), 0) / slipRows.length) * 10_000
    executionAlpha = Math.round((-avgSlipBps) * 100) / 100   // negative = cost
  }

  // Broker alpha — null unless broker present on inputs and ≥ 2 brokers.
  let brokerAlpha: number | null = null
  const byBroker = new Map<string, number[]>()
  for (const t of trades) {
    if (typeof t.broker === 'string' && t.broker) {
      const arr = byBroker.get(t.broker) ?? []
      arr.push(t.follower_pnl)
      byBroker.set(t.broker, arr)
    }
  }
  if (byBroker.size >= 2) {
    const means = [...byBroker.values()].map(arr => arr.reduce((a, b) => a + b, 0) / arr.length)
    const max = Math.max(...means)
    const min = Math.min(...means)
    brokerAlpha = meanAbs > 0
      ? Math.round(((max - min) / meanAbs) * 100 * 100) / 100
      : null
  }

  // Risk concentration — Herfindahl index of position size by symbol.
  // 100 = all in one symbol; near 0 = highly diversified.
  let riskConc: number | null = null
  const byLot = new Map<string, number>()
  for (const t of trades) {
    if (typeof t.symbol === 'string' && typeof t.lot_size === 'number') {
      byLot.set(t.symbol, (byLot.get(t.symbol) ?? 0) + t.lot_size)
    }
  }
  if (byLot.size > 0) {
    const total = [...byLot.values()].reduce((a, b) => a + b, 0)
    if (total > 0) {
      const hhi = [...byLot.values()].reduce((a, b) => a + (b / total) ** 2, 0)
      riskConc = Math.round(hhi * 100 * 100) / 100
    }
  }

  return {
    sample_size:  trades.length,
    omega,
    var_95:       var95,
    cvar_95:      cvar95,
    ulcer_index:  ui == null ? null : Math.round(ui * 100) / 100,
    mar,
    gain_to_pain: g2p,
    tail_risk_pct:       tailRisk,
    strategy_decay:      decay,
    regime_stability:    regimeStability,
    ci_95_lower:         Number.isFinite(ciLow)  ? ciLow  : null,
    ci_95_upper:         Number.isFinite(ciHigh) ? ciHigh : null,
    forward_test_reliability:    forwardReliability,
    validation_confidence_score: valConf,
    execution_alpha:     executionAlpha,
    broker_alpha:        brokerAlpha,
    risk_concentration:  riskConc,
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
        'Tail Risk = mean of worst 1% bucket ÷ mean |trade| × 100.',
        'Strategy Decay = recent-half PF ÷ older-half PF (<1 = decay). Requires ≥ 20 closed trades.',
        'Regime Stability = 1 - (stddev of windowed means ÷ |mean| + stddev), scaled 0-100. Requires ≥ 25 trades.',
        'CI 95% on mean trade pnl, t-approx (±1.96 σ/√n).',
        'Forward Test Reliability = 1 - |decay - 1|, scaled 0-100.',
        'Validation Confidence Score = 40% sample + 30% CI tightness + 30% regime stability.',
        'Execution Alpha = -avg |slippage_pct| × 10000 (basis points; negative = cost). Null when slippage not in input.',
        'Broker Alpha = (best broker mean - worst broker mean) ÷ mean |trade| × 100. Requires ≥ 2 brokers in input.',
        'Risk Concentration = Herfindahl index of position-size share by symbol × 100.',
      ],
    },
  }
}
