'use client'

import { useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen, Radio, WifiOff, Radar, ShieldAlert, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCryptoTickers } from '@/components/market/useCryptoTickers'
import LiveMarketPill from '@/components/ui/LiveMarketPill'

const LS_KEY = 'as_insight_drawer_open'

/**
 * Contextual insight rail (desktop, beta). A calm, always-available
 * context surface — market session + a live crypto pulse + quick jumps
 * — so traders read state without leaving the page. Reuses the shared
 * WS singleton (no extra connections) and shows honest stream state,
 * never a fabricated "live".
 */
export default function InsightDrawer() {
  const [open, setOpen] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setOpen(localStorage.getItem(LS_KEY) !== '0')
    setMounted(true)
  }, [])

  function toggle() {
    setOpen((v) => {
      const next = !v
      localStorage.setItem(LS_KEY, next ? '1' : '0')
      return next
    })
  }

  const { tickers, status } = useCryptoTickers()
  const live = status === 'live'
  const pulse = tickers.slice(0, 5)

  return (
    <aside
      className={cn(
        'hidden shrink-0 border-l border-border/60 glass-strong lg:flex lg:flex-col',
        mounted ? 'transition-[width] duration-300 ease-out' : '',
        open ? 'w-72' : 'w-12',
      )}
      aria-label="Insight rail"
    >
      <div className={cn('flex items-center border-b border-border/60 px-3 py-3', open ? 'justify-between' : 'justify-center')}>
        {open && (
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Context
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? 'Collapse insight rail' : 'Expand insight rail'}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          {open
            ? <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
            : <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />}
        </button>
      </div>

      {open && (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Market session — real, clock-derived */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Session
            </p>
            <LiveMarketPill />
          </div>

          {/* Live crypto pulse — shared WS singleton, honest state */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Crypto Pulse
              </p>
              <span className={cn('inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider', live ? 'text-emerald-300' : 'text-rose-300')}>
                {live
                  ? <><Radio className="h-2.5 w-2.5 animate-pulse-soft" strokeWidth={2.5} aria-hidden /> Live</>
                  : <><WifiOff className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden /> Offline</>}
              </span>
            </div>
            {pulse.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {live ? 'Loading…' : 'Stream unavailable — no prices to show.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {pulse.map((t) => {
                  const up = t.changePct >= 0
                  return (
                    <li key={t.symbol} className="flex items-baseline justify-between gap-2 tabular-nums">
                      <span className="text-[11px] font-semibold text-foreground/90">{t.label}</span>
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[11px]">${t.price >= 1 ? t.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : t.price.toFixed(4)}</span>
                        <span className={cn('text-[10px] font-bold', up ? 'text-emerald-400' : 'text-rose-400')}>
                          {up ? '+' : ''}{t.changePct.toFixed(2)}%
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Quick context jumps — real routes only */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Jump to
            </p>
            <nav className="flex flex-col gap-1">
              {[
                { href: '/regime', label: 'Market Regime', icon: Radar },
                { href: '/risk',   label: 'Risk Engine',   icon: ShieldAlert },
                { href: '/alerts', label: 'Smart Alerts',  icon: Bell },
              ].map((l) => {
                const Icon = l.icon
                return (
                  <a
                    key={l.href}
                    href={l.href}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                  >
                    <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} aria-hidden />
                    {l.label}
                  </a>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </aside>
  )
}
