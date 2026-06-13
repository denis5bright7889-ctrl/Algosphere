/**
 * Trade performance analytics for the Trader Intelligence Dashboard
 * (Refocus R4).
 *
 * Pure functions over `journal_entries`. No I/O. Computes the headline
 * KPIs (win rate, expectancy, profit factor, drawdown) plus segmented
 * breakdowns the coach narrative library uses to phrase insights
 * ("your London session beats NY", "your XAUUSD trades have +0.42 R
 * expectancy", etc.).
 *
 * Segmented breakdowns are returned sorted by `trades` desc so the UI
 * can render the top-N without re-sorting.
 *
 * Empty / thin samples never crash — segments with too few trades
 * return `null` for win_rate / expectancy. The UI hides them or shows
 * "—".
 */
import type { JournalEntry as BaseEntry } from '@/lib/types'

// See note in behavioral.ts — extending locally so R4 stays
// self-contained.
type JournalEntry = BaseEntry & {
  session?: string | null
}

const MIN_SEGMENT_TRADES = 4


export interface PerformanceReport {
  total_trades:    number
  closed_trades:   number
  total_pnl:       number
  total_pips:      number
  win_rate:        number | null      // 0–1
  loss_rate:       number | null
  break_even_rate: number | null
  profit_factor:   number | null
  expectancy:      number | null      // R-multiple proxy in pnl units
  avg_win:         number | null
  avg_loss:        number | null
  best_trade:      number | null
  worst_trade:     number | null
  max_drawdown:    number             // in pnl units (currency)
  max_drawdown_pct: number | null     // vs peak running equity

  by_pair:    SegmentRow[]
  by_session: SegmentRow[]
  by_setup:   SegmentRow[]
  by_dow:     SegmentRow[]            // day of week
}


export interface SegmentRow {
  key:        string
  trades:     number
  closed:     number
  wins:       number
  losses:     number
  win_rate:   number | null
  expectancy: number | null
  total_pnl:  number
  /** Confidence flag — true once trades >= MIN_SEGMENT_TRADES. */
  reliable:   boolean
}


export function analyzePerformance(
  entries: JournalEntry[],
  /** Current account equity (e.g. broker equity_usd). When known, drawdown is
   *  measured against real equity (peak seeded at equity − window PnL) instead
   *  of the PnL high-water mark — otherwise a tiny early peak produces absurd
   *  percentages like 3509%. Omit when no account base is available. */
  accountEquity?: number,
): PerformanceReport {
  const rows   = [...entries].sort(
    (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
  )
  const closed = rows.filter((r) => r.pnl != null)
  const winsArr   = closed.filter((r) => (r.pnl ?? 0) > 0)
  const lossesArr = closed.filter((r) => (r.pnl ?? 0) < 0)
  const beArr     = closed.filter((r) => (r.pnl ?? 0) === 0)

  const totalPnl = sum(closed.map((r) => r.pnl ?? 0))
  const totalPips = sum(closed.map((r) => r.pips ?? 0))

  const grossWin  = sum(winsArr.map((r) => r.pnl ?? 0))
  const grossLoss = Math.abs(sum(lossesArr.map((r) => r.pnl ?? 0)))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss
                       : grossWin > 0 ? Number.POSITIVE_INFINITY
                       : null

  const winRate   = closed.length ? winsArr.length   / closed.length : null
  const lossRate  = closed.length ? lossesArr.length / closed.length : null
  const beRate    = closed.length ? beArr.length     / closed.length : null
  const avgWin    = winsArr.length   ? mean(winsArr.map((r) => r.pnl as number))   : null
  const avgLoss   = lossesArr.length ? mean(lossesArr.map((r) => r.pnl as number)) : null
  const expectancy = (winRate != null && lossRate != null && avgWin != null && avgLoss != null)
    ? (winRate * avgWin) + (lossRate * avgLoss)
    : null

  // Drawdown — peak-to-trough on the equity curve. Seed at the account's
  // starting balance (current equity − window PnL) when known, so the % is
  // measured against real equity, not a near-zero early PnL peak. Clamp to
  // [0,1]: a fabricated 3509% is never a valid drawdown.
  const closedPnlTotal = closed.reduce((s, r) => s + (r.pnl ?? 0), 0)
  const startingBalance = (accountEquity != null && Number.isFinite(accountEquity) && accountEquity > 0)
    ? Math.max(0, accountEquity - closedPnlTotal)
    : 0
  let equity = startingBalance, peak = startingBalance, maxDd = 0
  for (const r of closed) {
    equity += r.pnl ?? 0
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDd) maxDd = dd
  }
  const maxDdPct = peak > 0 ? Math.min(maxDd / peak, 1) : (maxDd > 0 ? 1 : null)

  return {
    total_trades:    rows.length,
    closed_trades:   closed.length,
    total_pnl:       round2(totalPnl),
    total_pips:      round2(totalPips),
    win_rate:        winRate,
    loss_rate:       lossRate,
    break_even_rate: beRate,
    profit_factor:   profitFactor != null && Number.isFinite(profitFactor)
                     ? round2(profitFactor)
                     : profitFactor,
    expectancy:      expectancy != null ? round2(expectancy) : null,
    avg_win:         avgWin  != null ? round2(avgWin)  : null,
    avg_loss:        avgLoss != null ? round2(avgLoss) : null,
    best_trade:      winsArr.length   ? round2(Math.max(...winsArr.map((r) => r.pnl as number))) : null,
    worst_trade:     lossesArr.length ? round2(Math.min(...lossesArr.map((r) => r.pnl as number))) : null,
    max_drawdown:    round2(maxDd),
    max_drawdown_pct: maxDdPct,
    by_pair:    bucket(closed, (r) => r.pair      ?? null),
    by_session: bucket(closed, (r) => readSession(r)),
    by_setup:   bucket(closed, (r) => r.setup_tag ?? null),
    by_dow:     bucket(closed, (r) => dayOfWeek(r.trade_date ?? r.created_at)),
  }
}


// ─── Segmenting ──────────────────────────────────────────────────────

function bucket(closed: JournalEntry[], key: (r: JournalEntry) => string | null): SegmentRow[] {
  const groups = new Map<string, JournalEntry[]>()
  for (const r of closed) {
    const k = key(r)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const out: SegmentRow[] = []
  for (const [k, rows] of groups) {
    const wins   = rows.filter((r) => (r.pnl ?? 0) > 0).length
    const losses = rows.filter((r) => (r.pnl ?? 0) < 0).length
    const totalPnl = sum(rows.map((r) => r.pnl ?? 0))
    const winsArr   = rows.filter((r) => (r.pnl ?? 0) > 0).map((r) => r.pnl as number)
    const lossesArr = rows.filter((r) => (r.pnl ?? 0) < 0).map((r) => r.pnl as number)
    const wr  = rows.length ? wins / rows.length : null
    const aW  = winsArr.length   ? mean(winsArr)   : null
    const aL  = lossesArr.length ? mean(lossesArr) : null
    const exp = (wr != null && aW != null && aL != null && rows.length > 0)
      ? (wr * aW) + ((losses / rows.length) * aL)
      : null
    out.push({
      key:        k,
      trades:     rows.length,
      closed:     rows.length,
      wins,
      losses,
      win_rate:   rows.length >= MIN_SEGMENT_TRADES ? wr  : null,
      expectancy: rows.length >= MIN_SEGMENT_TRADES ? (exp != null ? round2(exp) : null) : null,
      total_pnl:  round2(totalPnl),
      reliable:   rows.length >= MIN_SEGMENT_TRADES,
    })
  }
  return out.sort((a, b) => b.trades - a.trades)
}


// ─── Helpers ─────────────────────────────────────────────────────────

function readSession(r: JournalEntry): string | null {
  // The schema has a free-form `session` column; normalize to the
  // canonical labels used elsewhere in the codebase.
  type S = JournalEntry & { session?: string | null }
  const raw = (r as S).session
  if (!raw) return null
  const t = raw.toLowerCase()
  if (t.includes('london') && t.includes('ny'))   return 'london_ny'
  if (t.includes('london')) return 'london'
  if (t.includes('ny') || t.includes('new_york') || t.includes('new york')) return 'new_york'
  if (t.includes('asia')) return 'asian'
  if (t.includes('off'))  return 'off_hours'
  return raw
}

function dayOfWeek(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? null
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
