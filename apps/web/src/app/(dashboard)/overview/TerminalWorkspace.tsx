'use client'

/**
 * TerminalWorkspace — the chart-first Command Center (MT5 / TradingView class).
 *
 * Replaces the old card-feed overview. A trading terminal leads with the
 * chart, not a wall of widgets. Layout:
 *
 *   ┌──────────────────────────────────────────┬───────────────┐
 *   │  symbol search · timeframe · KPI chips     │  WATCHLIST    │
 *   ├──────────────────────────────────────────┤  (click → load)│
 *   │                                            │               │
 *   │          full-bleed TradingView chart      ├───────────────┤
 *   │                                            │  ACTIVE       │
 *   │                                            │  SIGNALS      │
 *   └──────────────────────────────────────────┴───────────────┘
 *
 * The right rail collapses under lg. Everything is real data passed from
 * the server page — no fabricated numbers (honesty contract).
 */
import { useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, Minus, ChevronRight, Activity,
  PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import TradingViewEmbed from '@/components/charts/TradingViewEmbed'
import SymbolSearch from '@/components/charts/SymbolSearch'
import TimeframeSwitcher from '@/components/charts/TimeframeSwitcher'
import { toTradingViewSymbol, DEFAULT_INTERVAL } from '@/lib/tradingview'
import type { AssetClass } from '@/lib/market-universe'
import { cn } from '@/lib/utils'
import ActionDock from '@/components/dashboard/ActionDock'

export interface WatchItem {
  symbol:     string
  assetClass: AssetClass
}

export interface SignalItem {
  id:        string
  pair:      string
  direction: string
  status:    string
}

export interface TerminalKpis {
  netPnl:   number
  winRate:  number
  trades:   number
  active:   number
  bias:     { label: string; tone: 'emerald' | 'rose' | 'gold' | 'neutral' }
}

const TONE_TEXT: Record<TerminalKpis['bias']['tone'], string> = {
  emerald: 'text-emerald-400',
  rose:    'text-rose-400',
  gold:    'text-amber-300',
  neutral: 'text-muted-foreground',
}

export default function TerminalWorkspace({
  kpis, watchlist, signals, defaultSymbol,
}: {
  kpis:          TerminalKpis
  watchlist:     WatchItem[]
  signals:       SignalItem[]
  defaultSymbol: WatchItem
}) {
  const [symbol, setSymbol]     = useState(defaultSymbol.symbol)
  const [assetClass, setAsset]  = useState<AssetClass>(defaultSymbol.assetClass)
  const [interval, setInterval] = useState(DEFAULT_INTERVAL)
  const [railOpen, setRailOpen] = useState(true)

  const tvSymbol = toTradingViewSymbol(symbol, assetClass)
  const BiasIcon = kpis.bias.tone === 'emerald' ? TrendingUp
    : kpis.bias.tone === 'rose' ? TrendingDown : Minus

  function pick(s: string, a: AssetClass) { setSymbol(s); setAsset(a) }

  return (
    <div className="flex h-[calc(100vh-3.5rem-2rem)] min-h-[560px] flex-col gap-3">
      <div className="flex min-h-0 flex-1 gap-3">
      {/* ── Main column: toolbar + chart ─────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
        {/* Toolbar: symbol · timeframe · KPI chips */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
          <SymbolSearch current={symbol} onSelect={pick} />
          <span className="hidden rounded-md border border-border/60 bg-muted/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
            {assetClass}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <KpiChip label="Net P&L"
              value={kpis.trades > 0 ? `${kpis.netPnl >= 0 ? '+' : ''}$${kpis.netPnl.toFixed(2)}` : '—'}
              tone={kpis.trades === 0 ? 'neutral' : kpis.netPnl >= 0 ? 'emerald' : 'rose'} />
            <KpiChip label="Win" value={kpis.trades > 0 ? `${kpis.winRate}%` : '—'} tone="neutral" />
            <KpiChip label={kpis.bias.label} value="" tone={kpis.bias.tone} Icon={BiasIcon} />
            <div className="hidden md:block">
              <TimeframeSwitcher interval={interval} onChange={setInterval} />
            </div>
            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              aria-label={railOpen ? 'Hide side panel' : 'Show side panel'}
              className="hidden rounded-lg border border-border/60 p-2 text-muted-foreground transition-colors hover:text-foreground lg:block"
            >
              {railOpen
                ? <PanelRightClose className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                : <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            </button>
          </div>
        </div>

        {/* Chart */}
        <div className="relative min-h-0 flex-1">
          {tvSymbol ? (
            <TradingViewEmbed tvSymbol={tvSymbol} interval={interval} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {symbol} isn&apos;t chartable on the embedded widget.
            </div>
          )}
        </div>
      </div>

      {/* ── Right rail: watchlist + active signals ───────────────── */}
      {railOpen && (
        <div className="hidden w-72 shrink-0 flex-col gap-3 lg:flex">
          {/* Watchlist */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Watchlist</h2>
              <Link href="/watchlist" className="text-[10px] text-muted-foreground hover:text-foreground">Edit</Link>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {watchlist.map((w) => {
                const active = w.symbol === symbol
                return (
                  <li key={`${w.symbol}-${w.assetClass}`}>
                    <button
                      type="button"
                      onClick={() => pick(w.symbol, w.assetClass)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'hover:bg-accent/40',
                      )}
                    >
                      <span className="font-mono text-sm font-semibold">{w.symbol}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{w.assetClass}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Active signals */}
          <div className="flex max-h-[40%] min-h-[8rem] flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> Live Signals
              </h2>
              <Link href="/signals" className="flex items-center text-[10px] text-muted-foreground hover:text-foreground">
                All <ChevronRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {signals.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">No active signals right now.</li>
              ) : signals.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pick(s.pair, guessClass(s.pair))}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="font-mono text-sm font-semibold">{s.pair}</span>
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                      s.direction === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                    )}>
                      {s.direction}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      </div>

      {/* Persistent bottom action dock — Positions/Orders/Journal/Brokers/Alerts */}
      <ActionDock />
    </div>
  )
}

function KpiChip({ label, value, tone, Icon }: {
  label: string; value: string; tone: TerminalKpis['bias']['tone']; Icon?: typeof TrendingUp
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1">
      {Icon && <Icon className={cn('h-3.5 w-3.5', TONE_TEXT[tone])} strokeWidth={2} aria-hidden />}
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {value && <span className={cn('text-xs font-bold tabular-nums', TONE_TEXT[tone])}>{value}</span>}
    </div>
  )
}

/** Best-effort asset class from a signal pair when the row doesn't carry one. */
function guessClass(pair: string): AssetClass {
  const p = pair.toUpperCase()
  if (/USDT?$|USDC$/.test(p) && p.length > 6) return 'crypto'
  if (p.startsWith('XAU')) return 'gold'
  if (/^[A-Z]{6}$/.test(p)) return 'forex'
  return 'crypto'
}
