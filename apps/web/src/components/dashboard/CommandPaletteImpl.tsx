'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, CornerDownLeft, Zap, BookOpen, Landmark, FlaskConical, Cpu,
  ShieldCheck, Star, CandlestickChart, Bell, type LucideIcon,
} from 'lucide-react'
import { NAV_FLAT } from './nav'
import type { AssetClass } from '@/lib/market-universe'
import { cn } from '@/lib/utils'

/**
 * The ⌘K palette — now a command brain, not just a page jumper.
 *
 * Two kinds of result:
 *   • ACTIONS — verbs that DO something (open a chart for a symbol, log a
 *     trade, connect a broker, run a backtest, view positions/risk). Shown
 *     first so the palette feels operational, per the brief's "⌘K = brain".
 *   • PAGES — the full NAV_FLAT registry (jump anywhere).
 *
 * "Open chart" dispatches the global `open-chart` window event the
 * ChartModalProvider already listens for — a real action, no nav. Order
 * placement is deliberately NOT here: live trades route through the gated
 * execution path with confirmation, never a blind palette button.
 */
interface Props { open: boolean; onClose: () => void }

interface Cmd {
  id:        string
  label:     string
  icon:      LucideIcon
  keywords?: string
  hint:      string          // right-aligned descriptor (route or "Action")
  run:       () => void
}

const LIQUID: { symbol: string; assetClass: AssetClass }[] = [
  { symbol: 'BTCUSDT', assetClass: 'crypto' },
  { symbol: 'ETHUSDT', assetClass: 'crypto' },
  { symbol: 'SOLUSDT', assetClass: 'crypto' },
  { symbol: 'XAUUSD',  assetClass: 'gold'   },
  { symbol: 'EURUSD',  assetClass: 'forex'  },
  { symbol: 'NAS100',  assetClass: 'indices'},
]

export default function CommandPaletteImpl({ open, onClose }: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 20) }
  }, [open])

  // Build the command set once (router is stable). Actions first.
  const commands = useMemo<Cmd[]>(() => {
    const close = onClose
    const nav = (href: string) => { close(); router.push(href) }
    const openChart = (symbol: string, assetClass: AssetClass) => {
      close()
      window.dispatchEvent(new CustomEvent('open-chart', { detail: { symbol, assetClass } }))
    }

    const actions: Cmd[] = [
      { id: 'a-journal', label: 'Log a trade',        icon: BookOpen,        keywords: 'journal entry record new', hint: 'Action', run: () => nav('/journal') },
      { id: 'a-broker',  label: 'Connect a broker',   icon: Landmark,        keywords: 'broker binance bybit okx mt5 connect link api', hint: 'Action', run: () => nav('/brokers') },
      { id: 'a-backtest',label: 'Run a backtest',     icon: FlaskConical,    keywords: 'backtest simulate strategy test', hint: 'Action', run: () => nav('/backtest') },
      { id: 'a-positions',label: 'View positions',    icon: Cpu,             keywords: 'positions execution desk orders open', hint: 'Action', run: () => nav('/execution') },
      { id: 'a-risk',    label: 'Open Risk Engine',   icon: ShieldCheck,     keywords: 'risk exposure drawdown limits', hint: 'Action', run: () => nav('/risk') },
      { id: 'a-watch',   label: 'Manage watchlists',  icon: Star,            keywords: 'watchlist pin symbols favourites', hint: 'Action', run: () => nav('/watchlist') },
      { id: 'a-alerts',  label: 'Smart Alerts',       icon: Bell,            keywords: 'alerts notifications push triggers', hint: 'Action', run: () => nav('/alerts') },
      ...LIQUID.map((s): Cmd => ({
        id: `chart-${s.symbol}`,
        label: `Open chart · ${s.symbol}`,
        icon: CandlestickChart,
        keywords: `chart ${s.symbol} ${s.assetClass} switch asset symbol open`,
        hint: 'Chart',
        run: () => openChart(s.symbol, s.assetClass),
      })),
    ]

    const pages: Cmd[] = NAV_FLAT.map((i) => ({
      id: `nav-${i.href}`,
      label: i.label,
      icon: i.icon,
      keywords: i.keywords,
      hint: i.href,
      run: () => nav(i.href),
    }))

    return [...actions, ...pages]
  }, [router, onClose])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return commands
    return commands.filter((c) =>
      (c.label + ' ' + (c.keywords ?? '') + ' ' + c.hint).toLowerCase().includes(term),
    )
  }, [q, commands])

  useEffect(() => { setActive(0) }, [q])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/70 glass-strong shadow-glow animate-in slide-in-from-top-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border/60 px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter')     { e.preventDefault(); results[active]?.run() }
            }}
            placeholder="Search or run a command…  (try “log trade”, “btc”, “connect broker”)"
            aria-label="Search or run a command"
            className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden sm:block rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>
          )}
          {results.map((cmd, i) => {
            const Icon = cmd.icon
            const isAction = cmd.hint === 'Action' || cmd.hint === 'Chart'
            return (
              <li key={cmd.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => cmd.run()}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    i === active
                      ? 'bg-gradient-primary text-black shadow-glow'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="flex-1 text-left">{cmd.label}</span>
                  {isAction
                    ? <span className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                        i === active ? 'bg-black/15' : 'bg-primary/15 text-primary')}>
                        <Zap className="h-3 w-3" aria-hidden /> {cmd.hint}
                      </span>
                    : <span className="font-mono text-[11px] opacity-60">{cmd.hint}</span>}
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 opacity-80" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
