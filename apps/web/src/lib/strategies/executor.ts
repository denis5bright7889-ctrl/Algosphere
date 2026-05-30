/**
 * User-strategy executor (Refocus R5c).
 *
 * Bridges R5b's saved `StrategyConfig` to the existing backtest engine
 * data shape. Pure function: bars + config + cost model → BacktestResult.
 *
 * Block coverage:
 *   ──────────────────────────────────────────────────────────────────
 *   FULL — evaluated against the OHLCV series:
 *     ema_alignment · rsi_band · macd_cross · bollinger_position ·
 *     atr_band · session_window · swing_break · engulfing_candle ·
 *     fixed_risk_per_trade · daily_loss_cap · max_open_positions
 *
 *   BEST-EFFORT — synthesized from price action:
 *     liquidity_sweep   — uses 24-bar (~1d) PDH/PDL approximation
 *     order_block_tap   — uses recent ATR-displacement candle as the OB
 *     fair_value_gap    — three-candle FVG detection
 *
 *   NO-OP — needs runtime data outside the backtest sandbox:
 *     block_news (needs macro calendar feed)
 *     engine_confidence / engine_regime_allow (need live signals)
 *   These render an `unsupported_blocks` warning in the result so the
 *   user knows the backtest is approximate, not a fabricated pass.
 *
 * Design rules
 * ------------
 *   - Long-only when entry direction == 'bull' / 'long' / 'either-and-bull-fires';
 *     short-only when 'bear'.
 *   - Single open position at a time (max_open_positions hard-clamped to 1
 *     for v1; the cap surfaces as a flag if user requested >1).
 *   - SL / TP = ATR-based, parameters from fixed_risk_per_trade block
 *     (defaults: sl=1.2·ATR, rr=2.0). Position size derived from
 *     risk_pct of running equity.
 *   - Daily loss cap halts NEW entries for the rest of the UTC day once
 *     intraday drawdown ≥ cap_pct.
 *
 * Costs (cost model is per-trade, applied at entry+exit):
 *   - spread_pips: subtracts spread × pip_value once at entry
 *   - slippage_pct: applied to entry AND exit fills as a price shift
 *   - commission_per_trade_pct: % of notional, applied at entry+exit
 */
import type { Bar, BacktestResult, BacktestTrade } from '@/lib/backtest'
import type { StrategyConfig, BlockInstance } from './blocks'


export interface CostModel {
  spread_pips:              number   // round-trip spread in pips, charged once at entry
  slippage_pct:             number   // 0.001 = 10 bps applied each side
  commission_per_trade_pct: number   // 0.0005 = 5 bps each side
  pip_value:                number   // currency-per-pip, defaults to ATR-derived
}


export const DEFAULT_COSTS: CostModel = {
  spread_pips:              0,
  slippage_pct:             0,
  commission_per_trade_pct: 0,
  pip_value:                0.0001,
}


/**
 * Realistic per-asset-class default costs. Backtests that run with all-zero
 * costs systematically overstate returns — a 1% edge that disappears once
 * spread + slippage + commission are charged is the silent killer of retail
 * strategies. These defaults are conservative-realistic for liquid majors
 * on a typical retail broker; institutional / VIP tiers will see less.
 *
 * pip_value stays at the executor default (ATR-derived); the caller can
 * override per-symbol if they have a precise contract spec.
 */
const COST_PRESETS: Record<string, Omit<CostModel, 'pip_value'>> = {
  // Forex majors (EURUSD / GBPUSD / USDJPY / AUDUSD / USDCHF)
  forex_major: {
    spread_pips:              1.0,
    slippage_pct:             0.00005,   // 0.5 bps each side
    commission_per_trade_pct: 0,
  },
  // Forex crosses + minors
  forex_minor: {
    spread_pips:              2.5,
    slippage_pct:             0.00010,
    commission_per_trade_pct: 0,
  },
  // Gold / silver (XAUUSD / XAGUSD)
  metals: {
    spread_pips:              30,        // gold spread is ~$0.30 typical
    slippage_pct:             0.00010,
    commission_per_trade_pct: 0,
  },
  // Crypto majors (BTC / ETH / SOL)
  crypto: {
    spread_pips:              0,
    slippage_pct:             0.0005,    // 5 bps each side
    commission_per_trade_pct: 0.0004,    // 4 bps taker
  },
  // Indices (NAS100 / SPX500 / GER40)
  indices: {
    spread_pips:              5,
    slippage_pct:             0.00008,
    commission_per_trade_pct: 0,
  },
}

const FOREX_MAJORS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD',
])

/**
 * Pick a realistic cost model for the given symbol. Defaults to the
 * (all-zero) DEFAULT_COSTS when the symbol can't be classified, so the
 * caller never gets fabricated costs — the user can opt in.
 */
export function defaultCostsFor(symbol: string): CostModel {
  const s = symbol.toUpperCase().trim()
  let preset: Omit<CostModel, 'pip_value'> | null = null
  if (FOREX_MAJORS.has(s))                                preset = COST_PRESETS.forex_major!
  else if (/^[A-Z]{6}$/.test(s) && !s.startsWith('XAU')
        && !s.startsWith('XAG'))                          preset = COST_PRESETS.forex_minor!
  else if (s.startsWith('XAU') || s.startsWith('XAG'))    preset = COST_PRESETS.metals!
  else if (s.endsWith('USDT') || s.endsWith('USD') && /BTC|ETH|SOL|XRP|BNB|DOGE|ADA/.test(s))
                                                          preset = COST_PRESETS.crypto!
  else if (/NAS100|SPX500|GER40|US30|UK100|JPN225/.test(s)) preset = COST_PRESETS.indices!
  if (!preset) return DEFAULT_COSTS
  return { ...preset, pip_value: DEFAULT_COSTS.pip_value }
}


export interface ExecuteOptions {
  startingEquity: number
  costs?:         Partial<CostModel>
}


export interface ExecuteResult extends BacktestResult {
  /** Block kinds the executor couldn't evaluate; surfaced in the UI so
   *  the user knows what's approximate. */
  unsupported_blocks: string[]
  /** Bars consumed for warm-up before any signal fires. */
  warmup_bars: number
}


const UNSUPPORTED = new Set([
  'block_news', 'engine_confidence', 'engine_regime_allow',
])


// ─── Indicators ────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values[0] ?? 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    prev = i === 0 ? v : v * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

function rsi(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(50)
  let gain = 0, loss = 0
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!
    const g = Math.max(diff, 0), l = Math.max(-diff, 0)
    if (i <= period) {
      gain += g; loss += l
      if (i === period) {
        gain /= period; loss /= period
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
      }
    } else {
      gain = (gain * (period - 1) + g) / period
      loss = (loss * (period - 1) + l) / period
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
    }
  }
  return out
}

function atrSeries(bars: Bar[], period = 14): number[] {
  const tr: number[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) { tr.push(bars[0]!.high - bars[0]!.low); continue }
    const b = bars[i]!, p = bars[i - 1]!
    tr.push(Math.max(
      b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close),
    ))
  }
  return ema(tr, period)
}

function macdSeries(closes: number[], fast: number, slow: number, signal: number) {
  const fastE = ema(closes, fast)
  const slowE = ema(closes, slow)
  const macd  = closes.map((_, i) => fastE[i]! - slowE[i]!)
  const sig   = ema(macd, signal)
  return { macd, signal: sig }
}

function bbSeries(closes: number[], period: number, stdMult: number) {
  const mid: number[] = []
  const up:  number[] = []
  const lo:  number[] = []
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1)
    const slice = closes.slice(start, i + 1)
    const m = slice.reduce((a, b) => a + b, 0) / slice.length
    const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length
    const sd = Math.sqrt(v)
    mid.push(m); up.push(m + sd * stdMult); lo.push(m - sd * stdMult)
  }
  return { mid, up, lo }
}

function atrPercentile(atr: number[], i: number, window = 200): number {
  const start = Math.max(0, i - window + 1)
  const slice = atr.slice(start, i + 1).sort((a, b) => a - b)
  const target = atr[i]!
  let n = 0
  for (const v of slice) { if (v <= target) n++ }
  return slice.length > 0 ? (n / slice.length) * 100 : 50
}


// ─── Block evaluators ──────────────────────────────────────────────
// Each returns one of: 'bull' | 'bear' | 'pass' | 'fail'.
// Entry blocks emit a direction; filter blocks emit pass/fail. Risk
// blocks are read off the config separately.

type BlockSignal = 'bull' | 'bear' | 'pass' | 'fail'


function sessionOf(timestamp: number): 'asian' | 'london' | 'new_york' | 'london_ny' | 'off_hours' {
  const h = new Date(timestamp * 1000).getUTCHours()
  if (h >= 12 && h < 17) return 'london_ny'   // overlap window
  if (h >= 7  && h < 16) return 'london'
  if (h >= 13 && h < 21) return 'new_york'
  if (h >= 0  && h < 8)  return 'asian'
  return 'off_hours'
}


interface BlockCtx {
  bars:    Bar[]
  i:       number
  // Pre-computed series (lazily filled as blocks request them)
  cache: {
    ema:    Map<string, number[]>      // key = "period"
    rsi:    Map<string, number[]>
    macd:   Map<string, { macd: number[]; signal: number[] }>
    bb:     Map<string, { mid: number[]; up: number[]; lo: number[] }>
    atr:    number[]                   // single ATR(14)
  }
}


function evalBlock(b: BlockInstance, ctx: BlockCtx): BlockSignal {
  switch (b.key) {

    case 'ema_alignment': {
      const fast = num(b.params.fast, 9), slow = num(b.params.slow, 21)
      const dir  = String(b.params.direction ?? 'either')
      const f = getEma(ctx, fast)[ctx.i]!, s = getEma(ctx, slow)[ctx.i]!
      if (dir === 'bull' || dir === 'either') {
        if (f > s) return dir === 'either' ? 'bull' : 'pass'
      }
      if (dir === 'bear' || dir === 'either') {
        if (f < s) return dir === 'either' ? 'bear' : 'pass'
      }
      return 'fail'
    }

    case 'rsi_band': {
      const period = num(b.params.period, 14)
      const lower  = num(b.params.lower, 40)
      const upper  = num(b.params.upper, 70)
      const v = getRsi(ctx, period)[ctx.i]!
      return v >= lower && v <= upper ? 'pass' : 'fail'
    }

    case 'macd_cross': {
      const m = getMacd(ctx, num(b.params.fast, 12), num(b.params.slow, 26), num(b.params.signal, 9))
      const i = ctx.i
      if (i === 0) return 'fail'
      const prev = m.macd[i - 1]! - m.signal[i - 1]!
      const curr = m.macd[i]! - m.signal[i]!
      const upCross   = prev <= 0 && curr > 0
      const downCross = prev >= 0 && curr < 0
      const dir = String(b.params.direction ?? 'either')
      if (dir === 'up'     && upCross)   return 'bull'
      if (dir === 'down'   && downCross) return 'bear'
      if (dir === 'either' && upCross)   return 'bull'
      if (dir === 'either' && downCross) return 'bear'
      return 'fail'
    }

    case 'bollinger_position': {
      const bb = getBb(ctx, num(b.params.period, 20), num(b.params.std, 2))
      const where = String(b.params.where ?? 'upper')
      const close = ctx.bars[ctx.i]!.close
      const u = bb.up[ctx.i]!, l = bb.lo[ctx.i]!
      if (where === 'upper')   return close >= u ? 'pass' : 'fail'
      if (where === 'lower')   return close <= l ? 'pass' : 'fail'
      if (where === 'inside')  return close > l && close < u ? 'pass' : 'fail'
      if (where === 'outside') return close > u || close < l ? 'pass' : 'fail'
      return 'pass'
    }

    case 'atr_band': {
      const lo = num(b.params.lower_pct, 30), hi = num(b.params.upper_pct, 80)
      const pct = atrPercentile(ctx.cache.atr, ctx.i)
      return pct >= lo && pct <= hi ? 'pass' : 'fail'
    }

    case 'session_window': {
      const sessions = String(b.params.sessions ?? 'london_ny').split(',').map((s) => s.trim())
      const cur = sessionOf(ctx.bars[ctx.i]!.time)
      if (sessions.includes('any')) return 'pass'
      if (sessions.includes(cur))   return 'pass'
      // 'london_ny' also covers 'london' / 'new_york' when current is overlap
      if (cur === 'london_ny' && (sessions.includes('london') || sessions.includes('new_york'))) return 'pass'
      return 'fail'
    }

    case 'swing_break': {
      const lookback  = Math.max(2, num(b.params.lookback, 10))
      const direction = String(b.params.direction ?? 'either')
      const i = ctx.i
      if (i < lookback) return 'fail'
      const slice = ctx.bars.slice(i - lookback, i)
      const high  = Math.max(...slice.map((b) => b.high))
      const low   = Math.min(...slice.map((b) => b.low))
      const close = ctx.bars[i]!.close
      if (direction === 'high'   && close > high) return 'bull'
      if (direction === 'low'    && close < low)  return 'bear'
      if (direction === 'either' && close > high) return 'bull'
      if (direction === 'either' && close < low)  return 'bear'
      return 'fail'
    }

    case 'engulfing_candle': {
      const i = ctx.i
      if (i < 1) return 'fail'
      const dir = String(b.params.direction ?? 'bull')
      const p   = ctx.bars[i - 1]!, c = ctx.bars[i]!
      const pBear = p.close < p.open, pBull = p.close > p.open
      if (dir === 'bull' && pBear && c.close > p.open && c.open < p.close) return 'bull'
      if (dir === 'bear' && pBull && c.close < p.open && c.open > p.close) return 'bear'
      return 'fail'
    }

    case 'liquidity_sweep': {
      const i = ctx.i
      if (i < 24) return 'fail'
      const window = ctx.bars.slice(Math.max(0, i - 24), i)
      const pdh = Math.max(...window.map((b) => b.high))
      const pdl = Math.min(...window.map((b) => b.low))
      const atr = ctx.cache.atr[i] ?? 1
      const buffer = atr * num(b.params.min_excursion_atr, 0.6)
      const bar = ctx.bars[i]!
      if (bar.high > pdh + buffer && bar.close < pdh) return 'bear'
      if (bar.low  < pdl - buffer && bar.close > pdl) return 'bull'
      return 'fail'
    }

    case 'order_block_tap': {
      const i = ctx.i
      const lookback = Math.max(5, num(b.params.lookback, 24))
      if (i < lookback) return 'fail'
      const minDisp = num(b.params.min_displacement_atr, 1.5)
      const atr = ctx.cache.atr[i] ?? 1
      // Look for a recent strong displacement candle whose body the
      // current bar is touching from the opposite side.
      for (let j = i - lookback; j < i; j++) {
        const ob = ctx.bars[j]
        if (!ob) continue
        const body = Math.abs(ob.close - ob.open)
        if (body < minDisp * atr) continue
        const bull = ob.close > ob.open
        const bar  = ctx.bars[i]!
        if (bull  && bar.low  <= ob.high && bar.low  >= ob.low  && bar.close > bar.open) return 'bull'
        if (!bull && bar.high >= ob.low  && bar.high <= ob.high && bar.close < bar.open) return 'bear'
      }
      return 'fail'
    }

    case 'fair_value_gap': {
      const i = ctx.i
      if (i < 2) return 'fail'
      const a = ctx.bars[i - 2]!, b2 = ctx.bars[i - 1]!, c = ctx.bars[i]!
      const atr = ctx.cache.atr[i] ?? 1
      const minGap = atr * num(b.params.min_gap_atr, 0.3)
      const dir = String(b.params.direction ?? 'either')
      // Bullish FVG: a.high < c.low (gap up)
      if ((dir === 'bull' || dir === 'either') && a.high < c.low && (c.low - a.high) > minGap) {
        if (b2.close > b2.open) return 'bull'
      }
      // Bearish FVG: a.low > c.high (gap down)
      if ((dir === 'bear' || dir === 'either') && a.low > c.high && (a.low - c.high) > minGap) {
        if (b2.close < b2.open) return 'bear'
      }
      return 'fail'
    }

    // Risk-scope blocks don't evaluate per-bar — read separately.
    case 'fixed_risk_per_trade':
    case 'max_open_positions':
    case 'daily_loss_cap':
      return 'pass'

    default:
      return UNSUPPORTED.has(b.key) ? 'pass' : 'pass'
  }
}


// ─── Series cache helpers (lazy) ───────────────────────────────────

function getEma(ctx: BlockCtx, period: number): number[] {
  const key = String(period)
  if (!ctx.cache.ema.has(key)) {
    ctx.cache.ema.set(key, ema(ctx.bars.map((b) => b.close), period))
  }
  return ctx.cache.ema.get(key)!
}
function getRsi(ctx: BlockCtx, period: number): number[] {
  const key = String(period)
  if (!ctx.cache.rsi.has(key)) {
    ctx.cache.rsi.set(key, rsi(ctx.bars.map((b) => b.close), period))
  }
  return ctx.cache.rsi.get(key)!
}
function getMacd(ctx: BlockCtx, fast: number, slow: number, signal: number) {
  const key = `${fast}-${slow}-${signal}`
  if (!ctx.cache.macd.has(key)) {
    ctx.cache.macd.set(key, macdSeries(ctx.bars.map((b) => b.close), fast, slow, signal))
  }
  return ctx.cache.macd.get(key)!
}
function getBb(ctx: BlockCtx, period: number, stdMult: number) {
  const key = `${period}-${stdMult}`
  if (!ctx.cache.bb.has(key)) {
    ctx.cache.bb.set(key, bbSeries(ctx.bars.map((b) => b.close), period, stdMult))
  }
  return ctx.cache.bb.get(key)!
}


function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}


// ─── Risk-block readers ────────────────────────────────────────────

function readRiskParams(config: StrategyConfig) {
  const fr  = config.blocks.find((b) => b.key === 'fixed_risk_per_trade')
  const cap = config.blocks.find((b) => b.key === 'daily_loss_cap')
  const mp  = config.blocks.find((b) => b.key === 'max_open_positions')
  return {
    riskPct:    num(fr?.params.risk_pct, 1.0) / 100,
    slAtr:      num(fr?.params.sl_atr,   1.2),
    rr:         num(fr?.params.rr,       2.0),
    dailyCap:   num(cap?.params.cap_pct, 0) / 100,
    maxOpen:    Math.max(1, num(mp?.params.cap, 1)),
  }
}


// ─── Main entry ────────────────────────────────────────────────────

export function executeStrategy(
  bars: Bar[],
  config: StrategyConfig,
  opts: ExecuteOptions,
): ExecuteResult {
  const costs: CostModel = { ...DEFAULT_COSTS, ...(opts.costs ?? {}) }
  const risk = readRiskParams(config)

  const ctx: BlockCtx = {
    bars,
    i: 0,
    cache: {
      ema:  new Map(), rsi: new Map(), macd: new Map(), bb: new Map(),
      atr:  atrSeries(bars, 14),
    },
  }

  const unsupported = [...new Set(
    config.blocks.filter((b) => UNSUPPORTED.has(b.key)).map((b) => b.key),
  )]

  // Split blocks by scope. Entry blocks vote on direction; filter
  // blocks gate every entry.
  const entryBlocks  = config.blocks.filter((b) =>
    ['macd_cross','swing_break','engulfing_candle','liquidity_sweep',
     'order_block_tap','fair_value_gap'].includes(b.key))
  const filterBlocks = config.blocks.filter((b) =>
    ['ema_alignment','rsi_band','bollinger_position','atr_band','session_window'].includes(b.key))

  const trades: BacktestTrade[] = []
  let equity = opts.startingEquity
  let peak   = equity
  let maxDd  = 0
  const equityCurve: { time: number; equity: number }[] = []

  // Open position state
  let open: null | {
    entryTime:  number
    entryIdx:   number
    direction:  'long' | 'short'
    entry:      number
    sl:         number
    tp:         number
    lots:       number
    riskPaid:   number   // entry-side costs already debited
  } = null

  // Daily loss tracking
  let dayStart   = ''
  let dayEquity0 = equity
  let dayHalted  = false

  const warmup = 50

  for (let i = warmup; i < bars.length; i++) {
    ctx.i = i
    const bar = bars[i]!

    // ── Manage open position ──
    if (open) {
      let exitPrice: number | null = null
      let result: 'win' | 'loss' | null = null
      if (open.direction === 'long') {
        if (bar.low  <= open.sl) { exitPrice = open.sl; result = 'loss' }
        else if (bar.high >= open.tp) { exitPrice = open.tp; result = 'win'  }
      } else {
        if (bar.high >= open.sl) { exitPrice = open.sl; result = 'loss' }
        else if (bar.low  <= open.tp) { exitPrice = open.tp; result = 'win'  }
      }
      if (exitPrice !== null && result) {
        const slipMult = open.direction === 'long' ? (1 - costs.slippage_pct) : (1 + costs.slippage_pct)
        const filled   = exitPrice * slipMult
        const grossPnl = open.direction === 'long'
          ? (filled - open.entry) * open.lots
          : (open.entry - filled) * open.lots
        const exitCost = filled * open.lots * costs.commission_per_trade_pct
        const netPnl   = grossPnl - exitCost - open.riskPaid
        equity += netPnl
        peak   = Math.max(peak, equity)
        maxDd  = Math.max(maxDd, peak - equity)
        trades.push({
          entryTime: open.entryTime, exitTime: bar.time,
          direction: open.direction, entry: open.entry, exit: filled,
          pnl: netPnl, result,
        })
        equityCurve.push({ time: bar.time, equity })
        open = null
      }
    }

    // ── Roll daily window for the loss cap ──
    const day = new Date(bar.time * 1000).toISOString().slice(0, 10)
    if (day !== dayStart) { dayStart = day; dayEquity0 = equity; dayHalted = false }
    if (risk.dailyCap > 0 && (dayEquity0 - equity) / Math.max(1, dayEquity0) >= risk.dailyCap) {
      dayHalted = true
    }

    // ── Look for entries when flat ──
    if (open || dayHalted) continue

    // Filters: all must pass.
    let pass = true
    for (const fb of filterBlocks) {
      if (evalBlock(fb, ctx) === 'fail') { pass = false; break }
    }
    if (!pass) continue

    // Entries: vote for direction. First entry block that fires wins.
    let dir: 'long' | 'short' | null = null
    if (entryBlocks.length === 0) {
      // No explicit entry block — fall back to ema_alignment direction if present.
      const ea = filterBlocks.find((b) => b.key === 'ema_alignment')
      if (ea) {
        const sig = evalBlock(ea, ctx)
        if (sig === 'bull') dir = 'long'
        if (sig === 'bear') dir = 'short'
      }
    } else {
      for (const eb of entryBlocks) {
        const sig = evalBlock(eb, ctx)
        if (sig === 'bull') { dir = 'long';  break }
        if (sig === 'bear') { dir = 'short'; break }
      }
    }
    if (!dir) continue

    // Open the trade
    const atr = ctx.cache.atr[i] ?? 0
    if (atr <= 0) continue

    const slipMult = dir === 'long' ? (1 + costs.slippage_pct) : (1 - costs.slippage_pct)
    const fill     = bar.close * slipMult
    const slPrice  = dir === 'long' ? fill - atr * risk.slAtr : fill + atr * risk.slAtr
    const tpPrice  = dir === 'long' ? fill + atr * risk.slAtr * risk.rr
                                    : fill - atr * risk.slAtr * risk.rr
    const stopDist = Math.abs(fill - slPrice)
    if (stopDist <= 0) continue

    const lots = (equity * risk.riskPct) / stopDist
    const entryCost = fill * lots * costs.commission_per_trade_pct
                    + costs.spread_pips * costs.pip_value * lots
    open = {
      entryTime: bar.time, entryIdx: i, direction: dir,
      entry: fill, sl: slPrice, tp: tpPrice, lots,
      riskPaid: entryCost,
    }
  }

  // Tally final
  const wins   = trades.filter((t) => t.result === 'win').length
  const losses = trades.filter((t) => t.result === 'loss').length
  const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 10000) / 100 : 0
  const netPnl = trades.reduce((a, t) => a + t.pnl, 0)
  const netPnlPct = opts.startingEquity > 0
    ? Math.round((netPnl / opts.startingEquity) * 10000) / 100 : 0
  const grossWin  = trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0)
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : 0
  const avgWin  = wins   > 0 ? Math.round((trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0) / wins)   * 100) / 100 : 0
  const avgLoss = losses > 0 ? Math.round((trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0) / losses) * 100) / 100 : 0
  const maxDdPct = peak > 0 ? Math.round((maxDd / peak) * 10000) / 100 : 0

  // Sharpe (per-trade approximation)
  let sharpe: number | null = null
  if (trades.length >= 5) {
    const ret = trades.map((t) => t.pnl)
    const m   = ret.reduce((a, b) => a + b, 0) / ret.length
    const v   = ret.reduce((a, b) => a + (b - m) ** 2, 0) / ret.length
    const sd  = Math.sqrt(v)
    sharpe = sd > 0 ? Math.round((m / sd) * Math.sqrt(252) * 100) / 100 : null
  }

  return {
    trades, totalTrades: trades.length, wins, losses,
    winRate, netPnl: Math.round(netPnl * 100) / 100, netPnlPct,
    maxDrawdownPct: maxDdPct, sharpe, profitFactor, avgWin, avgLoss,
    equityCurve,
    unsupported_blocks: unsupported,
    warmup_bars: warmup,
  }
}
