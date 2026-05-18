import { Radar, Activity, ShieldCheck, Cpu, Target } from 'lucide-react'
import HeroCanvas from './HeroCanvas'

/**
 * Cinematic institutional terminal — the marketing hero surface.
 *
 * Terminal chrome + analyst overlays around a live-animating Canvas
 * market tape (`HeroCanvas`). This is a DESIGN surface, not a broker
 * feed: the badge reads DEMO and the whole block is aria-hidden so
 * assistive tech never announces it as real data. No fabricated
 * trader stats — the callout numbers are illustrative R:R geometry.
 */
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
            <span className="flex h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,200,66,0.6)] animate-pulse-soft" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">DEMO</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">EURUSD · 1H · simulated tape</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Radar className="h-3 w-3" strokeWidth={1.75} />
            AI markup
          </div>
        </header>

        {/* Live-animating market visual */}
        <div className="relative">
          <HeroCanvas />

          {/* Smart-money callout — illustrative R:R geometry */}
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
