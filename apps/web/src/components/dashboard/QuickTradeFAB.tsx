'use client'

/**
 * QuickTradeFAB — always-visible "Trade" floating action button.
 *
 * The spec's "execution must be 1-click accessible". Opens an order
 * ticket modal anywhere in the app: symbol · side · qty · SL · TP.
 * "Place Order" routes to /execution with the ticket as query params —
 * the gated Execution Desk does the actual broker submission (broker
 * connection check, risk gates, confirmation). No blind 1-click here.
 *
 * Hidden on /execution itself (you're already there) and on auth pages.
 * Sits above the mobile bottom nav (safe-area aware).
 */
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Zap, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Side = 'buy' | 'sell'

const PRESETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSD', 'EURUSD']

export default function QuickTradeFAB() {
  const router = useRouter()
  const pathname = usePathname() ?? ''

  const [open, setOpen]     = useState(false)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [side, setSide]     = useState<Side>('buy')
  const [qty, setQty]       = useState('')
  const [sl, setSL]         = useState('')
  const [tp, setTP]         = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Hide where it doesn't belong.
  if (pathname.startsWith('/execution') || pathname.startsWith('/login') || pathname.startsWith('/signup')) {
    return null
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    if (!sym || !Number(qty)) return
    const params = new URLSearchParams({ symbol: sym, side, qty: String(Number(qty)) })
    if (Number(sl)) params.set('sl', String(Number(sl)))
    if (Number(tp)) params.set('tp', String(Number(tp)))
    setOpen(false)
    router.push(`/execution?${params.toString()}`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick Trade"
        className={cn(
          'fixed right-4 z-40 flex items-center gap-1.5 rounded-full bg-gradient-primary px-4 py-3 text-sm font-bold text-black shadow-glow-gold transition-transform',
          'active:scale-95 hover:scale-[1.02]',
          // Mobile clears the bottom tab bar; desktop bottom-right.
          'bottom-[calc(96px+env(safe-area-inset-bottom))] md:bottom-6',
        )}
      >
        <Zap className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        <span className="hidden xs:inline sm:inline">Trade</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm p-3 sm:items-center"
             onClick={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h2 className="text-base font-bold tracking-tight">
                Quick <span className="text-gradient">Trade Ticket</span>
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground">
                <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* Symbol */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Symbol</label>
                <input
                  value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 font-mono text-sm outline-none focus:border-primary/60"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {PRESETS.map((p) => (
                    <button key={p} type="button" onClick={() => setSymbol(p)}
                      className={cn('rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold',
                        symbol === p ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground')}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Side */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Side</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSide('buy')}
                    className={cn('rounded-md border px-3 py-2 text-sm font-bold uppercase tracking-wide',
                      side === 'buy' ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-border/60 text-muted-foreground hover:text-foreground')}>
                    Buy
                  </button>
                  <button type="button" onClick={() => setSide('sell')}
                    className={cn('rounded-md border px-3 py-2 text-sm font-bold uppercase tracking-wide',
                      side === 'sell' ? 'border-rose-500/50 bg-rose-500/15 text-rose-300' : 'border-border/60 text-muted-foreground hover:text-foreground')}>
                    Sell
                  </button>
                </div>
              </div>

              {/* Qty */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quantity</label>
                <input
                  type="number" step="any" min="0" inputMode="decimal" placeholder="0.0"
                  value={qty} onChange={(e) => setQty(e.target.value)} required
                  className="mt-1 w-full rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 font-mono text-sm outline-none focus:border-primary/60"
                />
              </div>

              {/* SL / TP */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stop Loss (opt)</label>
                  <input type="number" step="any" inputMode="decimal" value={sl} onChange={(e) => setSL(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 font-mono text-sm outline-none focus:border-rose-500/60" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Take Profit (opt)</label>
                  <input type="number" step="any" inputMode="decimal" value={tp} onChange={(e) => setTP(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 font-mono text-sm outline-none focus:border-emerald-500/60" />
                </div>
              </div>

              {/* Honest disclaimer */}
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span>
                  Final confirmation happens on the <strong>Execution Desk</strong> —
                  broker connection check, risk gates, then submission. This ticket
                  prefills the desk; it does not place an order from here.
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
              <button type="button" onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button type="submit" disabled={!symbol.trim() || !Number(qty)}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-primary px-4 py-2 text-sm font-bold text-black shadow-glow-gold disabled:opacity-40">
                Open in Execution Desk →
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
