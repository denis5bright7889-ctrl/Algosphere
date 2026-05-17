import { Radar, Activity, ShieldCheck, Cpu, Target } from 'lucide-react'

/**
 * Cinematic "trading analyst" hero scene — institutional design
 * surface, not a live broker feed. Renders deterministic SVG:
 *   • Candlestick chart from a seeded random walk
 *   • Drawn-on analyst markup: support / resistance / Fibonacci
 *     retracement / entry zone / stop-loss / take-profit
 *   • Floating AI-signal callout with R:R + confidence
 *   • Bottom liquidity-heatmap strip
 *
 * Same shape every render (mulberry32 seeded). Decorative only:
 * NOT a price feed, NOT fabricated trader stats.
 */

// ─── Deterministic seeded RNG ────────────────────────────────────
function rng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Candle { o: number; h: number; l: number; c: number }

function generateCandles(count: number, seed: number): Candle[] {
  const r = rng(seed)
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < count; i++) {
    const drift = (r() - 0.485) * 2.4
    const open  = price
    const close = open + drift
    const wickU = r() * 1.8
    const wickD = r() * 1.8
    const high  = Math.max(open, close) + wickU
    const low   = Math.min(open, close) - wickD
    out.push({ o: open, h: high, l: low, c: close })
    price = close
  }
  return out
}

const CANDLE_COUNT = 56
const CHART = { w: 480, h: 220, padX: 8, padTop: 10, padBot: 14 }
const candles = generateCandles(CANDLE_COUNT, 20260518)
const minP = Math.min(...candles.map((c) => c.l))
const maxP = Math.max(...candles.map((c) => c.h))
const span = maxP - minP

const innerW = CHART.w - CHART.padX * 2
const innerH = CHART.h - CHART.padTop - CHART.padBot
const colW   = innerW / CANDLE_COUNT
const bodyW  = Math.max(2.2, colW * 0.62)

function priceY(p: number): number {
  return CHART.padTop + (1 - (p - minP) / span) * innerH
}
function candleX(i: number): number {
  return CHART.padX + i * colW + colW / 2
}

// Analyst markup — swing levels drawn from the seeded series
const swingHigh = Math.max(...candles.slice(-30, -8).map((c) => c.h))
const swingLow  = Math.min(...candles.slice(-30, -8).map((c) => c.l))
const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 1] as const
const fibPoints = fibLevels.map((r) => swingLow + r * (swingHigh - swingLow))

const last       = candles[candles.length - 1]!
const entryPrice = last.c
const stopPrice  = entryPrice - span * 0.06
const takePrice  = entryPrice + span * 0.18 // ≈ 1:3 R:R

// Subtle MA-20 line so the chart feels analysed
function ma(period: number): string {
  const pts: string[] = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let k = i - period + 1; k <= i; k++) sum += candles[k]!.c
    const x = candleX(i).toFixed(1)
    const y = priceY(sum / period).toFixed(1)
    pts.push(`${pts.length === 0 ? 'M' : 'L'}${x},${y}`)
  }
  return pts.join(' ')
}
const maPath = ma(20)

export default function HeroPreview() {
  return (
    <div className="relative w-full max-w-xl mx-auto lg:mx-0 animate-fade-in" aria-hidden>
      {/* Outer glow */}
      <div className="absolute -inset-6 rounded-3xl bg-gradient-primary opacity-20 blur-2xl" />

      {/* Terminal chrome */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-strong shadow-glow">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" />

        {/* Top bar */}
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">LIVE</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">EURUSD · 1H</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Radar className="h-3 w-3" strokeWidth={1.75} />
            AI markup
          </div>
        </header>

        {/* Chart + analyst markup */}
        <div className="relative">
          <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} className="block h-56 sm:h-64 w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="heroEntryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#10b981" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="heroSLFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#f43f5e" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Background grid */}
            {[0.25, 0.5, 0.75].map((p) => (
              <line key={p} x1="0" y1={CHART.padTop + innerH * p} x2={CHART.w}
                    y2={CHART.padTop + innerH * p}
                    stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
            ))}

            {/* Fibonacci retracement */}
            {fibPoints.map((p, i) => {
              const y = priceY(p)
              const ratio = fibLevels[i]!
              return (
                <g key={i}>
                  <line x1={CHART.padX} y1={y} x2={CHART.w - 28} y2={y}
                        stroke="#a78bfa" strokeOpacity={ratio === 0.5 ? 0.55 : 0.35}
                        strokeWidth="0.8" strokeDasharray="3 3" />
                  <text x={CHART.w - 26} y={y + 3} fontSize="8" fill="#a78bfa" opacity="0.7"
                        fontFamily="ui-monospace, monospace">
                    {ratio.toFixed(3)}
                  </text>
                </g>
              )
            })}

            {/* Take-profit line */}
            {(() => {
              const y = priceY(takePrice)
              return (
                <g>
                  <line x1={CHART.padX} y1={y} x2={CHART.w - 32} y2={y}
                        stroke="#10b981" strokeOpacity="0.9" strokeWidth="1" strokeDasharray="5 3" />
                  <text x={CHART.w - 30} y={y - 3} fontSize="8" fill="#10b981"
                        fontFamily="ui-monospace, monospace">TP1</text>
                </g>
              )
            })()}

            {/* Stop-loss zone */}
            {(() => {
              const y = priceY(stopPrice)
              return (
                <g>
                  <rect x={CHART.padX} y={y} width={CHART.w - CHART.padX * 2}
                        height={priceY(minP) - y} fill="url(#heroSLFill)" />
                  <line x1={CHART.padX} y1={y} x2={CHART.w - 32} y2={y}
                        stroke="#f43f5e" strokeOpacity="0.85" strokeWidth="1" strokeDasharray="5 3" />
                  <text x={CHART.w - 30} y={y - 3} fontSize="8" fill="#f43f5e"
                        fontFamily="ui-monospace, monospace">SL</text>
                </g>
              )
            })()}

            {/* Entry zone */}
            {(() => {
              const yMid = priceY(entryPrice)
              const yTop = priceY(entryPrice + span * 0.012)
              const yBot = priceY(entryPrice - span * 0.012)
              return (
                <g>
                  <rect x={CHART.padX} y={yTop} width={CHART.w - CHART.padX * 2}
                        height={yBot - yTop} fill="url(#heroEntryFill)" />
                  <line x1={CHART.padX} y1={yMid} x2={CHART.w - 32} y2={yMid}
                        stroke="#fbbf24" strokeOpacity="0.95" strokeWidth="1" />
                  <text x={CHART.w - 30} y={yMid - 3} fontSize="8" fill="#fbbf24"
                        fontFamily="ui-monospace, monospace">ENTRY</text>
                </g>
              )
            })()}

            {/* Candles */}
            {candles.map((c, i) => {
              const x  = candleX(i)
              const up = c.c >= c.o
              const yO = priceY(c.o)
              const yC = priceY(c.c)
              const yH = priceY(c.h)
              const yL = priceY(c.l)
              const fill   = up ? '#10b981' : '#f43f5e'
              const stroke = up ? '#34d399' : '#fb7185'
              const top    = Math.min(yO, yC)
              const hgt    = Math.max(1, Math.abs(yC - yO))
              return (
                <g key={i}>
                  <line x1={x} y1={yH} x2={x} y2={yL} stroke={stroke} strokeWidth="1" opacity="0.85" />
                  <rect x={x - bodyW / 2} y={top} width={bodyW} height={hgt} fill={fill} opacity="0.95" />
                </g>
              )
            })}

            {/* MA-20 — subtle trend line */}
            <path d={maPath} fill="none" stroke="#fbbf24" strokeOpacity="0.55" strokeWidth="1" />

            {/* Last-price tag */}
            {(() => {
              const x = candleX(CANDLE_COUNT - 1) + bodyW
              const y = priceY(entryPrice)
              return (
                <g>
                  <circle cx={x} cy={y} r="2.5" fill="#fbbf24" />
                  <circle cx={x} cy={y} r="5"   fill="#fbbf24" opacity="0.2" />
                </g>
              )
            })()}
          </svg>

          {/* Smart-money callout */}
          <div className="absolute right-3 top-3 inline-flex flex-col items-end gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] backdrop-blur-sm">
            <span className="flex items-center gap-1.5 font-bold text-emerald-300">
              <Activity className="h-3 w-3" strokeWidth={2} />
              AI SIGNAL · BUY
            </span>
            <span className="text-[9px] text-emerald-200/80 tabular-nums font-mono">
              R:R 1:3 · conf 78
            </span>
          </div>
        </div>

        {/* Liquidity heatmap strip — illustrative gradient zones */}
        <div className="relative h-3 border-t border-border/60">
          <div
            className={
              'absolute inset-y-0 left-0 w-full ' +
              'bg-[linear-gradient(90deg,' +
              'rgba(244,63,94,0)_0%,' +
              'rgba(244,63,94,0.35)_18%,' +
              'rgba(244,63,94,0)_32%,' +
              'rgba(251,191,36,0.3)_48%,' +
              'rgba(251,191,36,0)_58%,' +
              'rgba(16,185,129,0.4)_78%,' +
              'rgba(16,185,129,0)_100%)]'
            }
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
            Liquidity
          </span>
        </div>

        {/* Footer chips */}
        <footer className="grid grid-cols-3 gap-3 border-t border-border/60 px-4 py-3 text-[10px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Target className="h-3 w-3 text-amber-300" strokeWidth={2} />
            Smart-money markup
          </div>
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-emerald-300" strokeWidth={2} />
            Risk engine
          </div>
          <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
            <Cpu className="h-3 w-3 text-amber-300" strokeWidth={2} />
            Auto-execute
          </div>
        </footer>
      </div>

      {/* Floating analytics card — bottom-left overlay */}
      <div className="absolute -bottom-4 -left-3 hidden sm:flex items-center gap-2 rounded-xl border border-border/70 glass-strong px-3 py-2 shadow-glow animate-fade-in">
        <ShieldCheck className="h-4 w-4 text-emerald-300" strokeWidth={1.75} />
        <span className="text-[11px] font-semibold">12-gate risk engine</span>
      </div>

      {/* Floating analytics card — top-right overlay */}
      <div className="absolute -top-3 -right-3 hidden sm:flex items-center gap-2 rounded-xl border border-border/70 glass-strong px-3 py-2 shadow-glow animate-fade-in">
        <Cpu className="h-4 w-4 text-amber-300" strokeWidth={1.75} />
        <span className="text-[11px] font-semibold">Binance · Bybit · OKX · MT5</span>
      </div>
    </div>
  )
}
