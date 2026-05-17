import { Radar, Activity, ShieldCheck, Cpu } from 'lucide-react'

/**
 * Hero "product preview" — a glassmorphic mock of the AlgoSphere
 * dashboard chrome. Decorative by design: the chart line is a
 * deterministic seeded walk drawn into an SVG (NOT a live market
 * quote), and the regime tiles use generic labels. This is the
 * institutional design surface — never claims to be a live broker
 * feed, never invents trader-specific numbers.
 */

// Deterministic seeded RNG (mulberry32). Same seed → same chart every render.
function rng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Builds a smooth random-walk path for the hero chart. */
function chartPath(width: number, height: number, points: number) {
  const r = rng(20260517)
  const ys: number[] = []
  let v = height * 0.55
  for (let i = 0; i < points; i++) {
    v += (r() - 0.46) * 18
    v = Math.max(height * 0.18, Math.min(height * 0.82, v))
    ys.push(v)
  }
  const stepX = width / (points - 1)
  // Build a smooth quadratic-bezier path so it looks like a real chart line.
  let d = `M0,${ys[0]!.toFixed(1)}`
  for (let i = 1; i < points; i++) {
    const x = (i * stepX).toFixed(1)
    const cx = ((i - 0.5) * stepX).toFixed(1)
    const cy = ((ys[i - 1]! + ys[i]!) / 2).toFixed(1)
    d += ` Q${cx},${cy} ${x},${ys[i]!.toFixed(1)}`
  }
  // Fill path (close to bottom-right then bottom-left)
  const fillD = `${d} L${width},${height} L0,${height} Z`
  return { line: d, fill: fillD }
}

const REGIME_TILES = [
  { sym: 'XAUUSD',  tone: 'emerald' },
  { sym: 'EURUSD',  tone: 'rose'    },
  { sym: 'BTCUSDT', tone: 'emerald' },
  { sym: 'ETHUSDT', tone: 'amber'   },
] as const

const TONE_BG: Record<string, string> = {
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rose:    'bg-rose-500/15 text-rose-300 border-rose-500/30',
  amber:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

export default function HeroPreview() {
  const W = 480, H = 220
  const path = chartPath(W, H, 60)

  return (
    <div
      className="relative w-full max-w-xl mx-auto lg:mx-0 animate-fade-in"
      aria-hidden
    >
      {/* Outer glow */}
      <div
        className="absolute -inset-6 rounded-3xl bg-gradient-primary opacity-20 blur-2xl"
      />

      {/* Terminal chrome */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-strong shadow-glow">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary" />

        {/* Top bar */}
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
              LIVE
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              AI Regime Engine
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Radar className="h-3 w-3" strokeWidth={1.75} />
            24 instruments · 5m scan
          </div>
        </header>

        {/* Chart area */}
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-44 sm:h-52 w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="heroChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#f59e0b" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="heroChartLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            {/* Grid */}
            {[0.25, 0.5, 0.75].map((p) => (
              <line
                key={p} x1="0" y1={H * p} x2={W} y2={H * p}
                stroke="currentColor" strokeOpacity="0.08" strokeWidth="1"
              />
            ))}
            <path d={path.fill} fill="url(#heroChartFill)" />
            <path d={path.line} fill="none" stroke="url(#heroChartLine)" strokeWidth="2" />
          </svg>

          {/* Floating AI Sentiment chip */}
          <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
            <Activity className="h-3 w-3" strokeWidth={2} />
            Risk-On bias
          </div>
        </div>

        {/* Regime tile row */}
        <div className="grid grid-cols-4 gap-2 border-t border-border/60 px-4 py-3">
          {REGIME_TILES.map((t) => (
            <div
              key={t.sym}
              className={
                'rounded-md border px-2 py-1.5 text-center text-[10px] font-mono font-semibold ' +
                TONE_BG[t.tone]
              }
            >
              {t.sym}
            </div>
          ))}
        </div>

        {/* Footer chips */}
        <footer className="grid grid-cols-3 gap-3 border-t border-border/60 px-4 py-3 text-[10px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-emerald-300" strokeWidth={2} />
            Risk engine
          </div>
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
            <Cpu className="h-3 w-3 text-amber-300" strokeWidth={2} />
            Auto-execute
          </div>
          <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
            <Radar className="h-3 w-3 text-amber-300" strokeWidth={2} />
            Multi-broker
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
