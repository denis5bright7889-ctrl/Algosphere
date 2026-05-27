'use client'

/**
 * Searchable symbol selector for the chart modal (Phase 5).
 *
 * Built from the canonical MARKET_UNIVERSE, filtered to chartable
 * instruments and grouped by category (Crypto / Forex / Metals / Indices
 * / Stocks / …). The trigger shows the current symbol; opening reveals a
 * search box + grouped list. Designed to scale to hundreds of symbols —
 * the list virtualises naturally via the search filter and per-group caps.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MARKET_UNIVERSE, type AssetClass } from '@/lib/market-universe'
import { isChartable } from '@/lib/tradingview'

interface Row { symbol: string; label: string; assetClass: AssetClass; group: string }

// Display grouping order — the brief's Crypto/Forex/Metals/Indices first.
const GROUP_ORDER: Record<string, number> = {
  Crypto: 0, Forex: 1, Metals: 2, Indices: 3, Stocks: 4,
  Commodities: 5, Futures: 6, Volatility: 7, Bonds: 8,
}

function displayGroup(c: AssetClass): string {
  if (c === 'gold') return 'Metals'
  if (c === 'commodities') return 'Commodities'
  return c.charAt(0).toUpperCase() + c.slice(1)
}

const ALL_ROWS: Row[] = MARKET_UNIVERSE.flatMap((c) =>
  c.instruments
    .filter((i) => isChartable(i.symbol, i.assetClass))
    .map((i) => ({
      symbol: i.symbol, label: i.label, assetClass: i.assetClass,
      group: displayGroup(i.assetClass),
    })),
)

export default function SymbolSearch({
  current, onSelect,
}: {
  current: string
  onSelect: (symbol: string, assetClass: AssetClass) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20)
    else setQ('')
  }, [open])

  // Close on outside click / ESC.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const grouped = useMemo(() => {
    const term = q.trim().toLowerCase()
    const rows = term
      ? ALL_ROWS.filter((r) => (r.symbol + ' ' + r.label).toLowerCase().includes(term))
      : ALL_ROWS
    const byGroup = new Map<string, Row[]>()
    for (const r of rows) {
      const arr = byGroup.get(r.group) ?? []
      arr.push(r)
      byGroup.set(r.group, arr)
    }
    return [...byGroup.entries()].sort(
      (a, b) => (GROUP_ORDER[a[0]] ?? 99) - (GROUP_ORDER[b[0]] ?? 99),
    )
  }, [q])

  function pick(r: Row) {
    onSelect(r.symbol, r.assetClass)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-sm font-bold tracking-tight hover:border-amber-500/40"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border/70 glass-strong shadow-glow">
          <div className="flex items-center gap-2 border-b border-border/60 px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol…"
              aria-label="Search symbol"
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {grouped.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</p>
            )}
            {grouped.map(([group, rows]) => (
              <div key={group} className="mb-1">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  {group}
                </p>
                {rows.slice(0, 40).map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => pick(r)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                      r.symbol === current ? 'bg-amber-500/15 text-amber-200'
                                           : 'text-foreground/90 hover:bg-accent/50',
                    )}
                  >
                    <span className="truncate">{r.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{r.symbol}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
