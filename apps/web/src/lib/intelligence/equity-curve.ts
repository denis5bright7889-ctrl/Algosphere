/**
 * Equity-curve calculator — Phase 6 of the Validation Center.
 *
 * Pure function over closed shadow trades. Produces an array of
 * curve points the Recharts area+line component renders directly:
 *
 *   • cumulative_pnl       — running sum of follower_pnl
 *   • drawdown             — peak − current (always ≥ 0)
 *   • drawdown_pct         — drawdown as % of running peak
 *   • rolling_win_rate     — % winners in trailing window
 *   • daily_pnl            — sum of pnl on that calendar day
 *   • confidence_low / high — ±1 stddev bands around cumulative PnL
 *
 * Honesty contract:
 *   - Returns empty array when there are zero closed trades. The
 *     chart component renders an empty-state placeholder rather than
 *     a single misleading dot at zero.
 *   - Confidence band is null until ≥ MIN_BAND_SAMPLE points exist —
 *     a stddev on 3 trades is meaningless.
 *   - Day-level aggregation uses the closed_at date (UTC); trades
 *     without a closed_at are dropped (not back-filled to created_at —
 *     that would conflate intent with outcome).
 */

export const CURVE_MIN_BAND_SAMPLE = 10
const ROLLING_WIN_WINDOW = 20    // trailing trades for rolling win rate

export interface CurveTrade {
  follower_pnl: number
  closed_at:    string | null
}

export interface CurvePoint {
  /** ISO date or trade index — Recharts XAxis key. */
  x:                 string
  /** Cumulative P&L through this point. */
  cumulative_pnl:    number
  /** Daily P&L bucket (for daily/weekly/monthly views). */
  daily_pnl:         number
  /** Drawdown in account currency (peak − current, ≥ 0). */
  drawdown:          number
  /** Drawdown as % of running peak. */
  drawdown_pct:      number
  /** Rolling win rate over the trailing window (0-100, or null when
   *  the window isn't full yet). */
  rolling_win_rate:  number | null
  /** Lower confidence bound (null below MIN_BAND_SAMPLE). */
  confidence_low:    number | null
  /** Upper confidence bound. */
  confidence_high:   number | null
  /** Trade index for tooltip context. */
  trade_index:       number
}

export interface CurveSummary {
  point_count:        number
  net_pnl:            number
  peak_pnl:           number
  max_drawdown:       number
  max_drawdown_pct:   number
  current_drawdown:   number
  final_win_rate:     number | null
  curve_start_date:   string | null
  curve_end_date:     string | null
}

export interface EquityCurve {
  points:  CurvePoint[]
  summary: CurveSummary
}

function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

export function buildEquityCurve(trades: CurveTrade[]): EquityCurve {
  const empty: EquityCurve = {
    points: [],
    summary: {
      point_count:      0,
      net_pnl:          0,
      peak_pnl:         0,
      max_drawdown:     0,
      max_drawdown_pct: 0,
      current_drawdown: 0,
      final_win_rate:   null,
      curve_start_date: null,
      curve_end_date:   null,
    },
  }

  // Only trades with a real close timestamp count — intent ≠ outcome.
  const closed = trades
    .filter(t => typeof t.closed_at === 'string' && typeof t.follower_pnl === 'number')
    .map(t => ({ pnl: t.follower_pnl, closed_at: t.closed_at as string }))
    .sort((a, b) => a.closed_at.localeCompare(b.closed_at))

  if (closed.length === 0) return empty

  // Bucket by calendar date so the chart shows one point per day even
  // if 5 trades closed in the same hour.
  const byDay = new Map<string, number[]>()
  for (const t of closed) {
    const key = dateKey(t.closed_at)
    const arr = byDay.get(key) ?? []
    arr.push(t.pnl)
    byDay.set(key, arr)
  }
  const days = [...byDay.keys()].sort()

  const points: CurvePoint[] = []
  let cumulative = 0
  let peak       = 0
  let maxDD      = 0
  let maxDDPct   = 0
  let tradeIdx   = 0
  // For rolling win rate we keep the trade-level sequence in order.
  const seenWinFlags: boolean[] = []

  for (const day of days) {
    const pnls = byDay.get(day)!
    const dailyPnl = pnls.reduce((a, b) => a + b, 0)
    cumulative += dailyPnl

    for (const p of pnls) {
      tradeIdx++
      seenWinFlags.push(p > 0)
    }

    if (cumulative > peak) peak = cumulative
    const drawdown    = Math.max(0, peak - cumulative)
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0
    if (drawdown    > maxDD)    maxDD    = drawdown
    if (drawdownPct > maxDDPct) maxDDPct = drawdownPct

    // Rolling win rate over the trailing window.
    const winWindow = seenWinFlags.slice(-ROLLING_WIN_WINDOW)
    const winRate   = winWindow.length >= Math.min(ROLLING_WIN_WINDOW, 5)
      ? Math.round((winWindow.filter(Boolean).length / winWindow.length) * 100)
      : null

    // Confidence band — ±1 stddev around the running cumulative once
    // we have enough trades. Below threshold both bounds are null.
    let confLow: number | null = null
    let confHigh: number | null = null
    if (tradeIdx >= CURVE_MIN_BAND_SAMPLE) {
      const allPnls: number[] = []
      for (const arr of byDay.values()) {
        for (const p of arr) allPnls.push(p)
        if (allPnls.length >= tradeIdx) break
      }
      const sd = stdev(allPnls.slice(0, tradeIdx))
      // Approximate the band as cumulative ± sd × sqrt(N). Standard
      // error of the sum of N i.i.d. samples.
      const band = sd * Math.sqrt(tradeIdx)
      confLow  = Math.round((cumulative - band) * 100) / 100
      confHigh = Math.round((cumulative + band) * 100) / 100
    }

    points.push({
      x:                day,
      cumulative_pnl:   Math.round(cumulative * 100) / 100,
      daily_pnl:        Math.round(dailyPnl * 100) / 100,
      drawdown:         Math.round(drawdown * 100) / 100,
      drawdown_pct:     Math.round(drawdownPct * 100) / 100,
      rolling_win_rate: winRate,
      confidence_low:   confLow,
      confidence_high:  confHigh,
      trade_index:      tradeIdx,
    })
  }

  const final = points[points.length - 1]!
  const allWinFlags = closed.map(t => t.pnl > 0)
  const finalWinRate = allWinFlags.length > 0
    ? Math.round((allWinFlags.filter(Boolean).length / allWinFlags.length) * 100)
    : null

  return {
    points,
    summary: {
      point_count:      points.length,
      net_pnl:          Math.round(cumulative * 100) / 100,
      peak_pnl:         Math.round(peak * 100) / 100,
      max_drawdown:     Math.round(maxDD * 100) / 100,
      max_drawdown_pct: Math.round(maxDDPct * 100) / 100,
      current_drawdown: final.drawdown,
      final_win_rate:   finalWinRate,
      curve_start_date: points[0]!.x,
      curve_end_date:   final.x,
    },
  }
}
