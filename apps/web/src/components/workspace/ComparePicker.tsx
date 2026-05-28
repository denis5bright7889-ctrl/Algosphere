'use client'

/**
 * Per-panel compare overlay picker. Adds up to MAX_COMPARE chartable
 * symbols from the registry; the TradingView Advanced Chart honours
 * `compare_symbols` natively. A small popover, search-driven.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from './WorkspaceProvider'
import { MAX_COMPARE } from '@/lib/workspace-store'
import { symbolRegistry } from '@/lib/symbol-registry'
import type { ChartPanelState } from '@/lib/workspace-store'

const REGISTRY = symbolRegistry().filter((m) => m.enabled && m.chart_supported)

export default function ComparePicker({ panel }: { panel: ChartPanelState }) {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20)
    else setQ('')
  }, [open])

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

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    return REGISTRY
      .filter((m) => m.symbol !== panel.symbol && !panel.compareWith.includes(m.symbol))
      .filter((m) => !term || (m.symbol + ' ' + m.display_name).toLowerCase().includes(term))
      .slice(0, 30)
  }, [q, panel.symbol, panel.compareWith])

  const atLimit = panel.compareWith.length >= MAX_COMPARE

  return (
    <div ref={rootRef} className="relative">
      <button type="button"
              onClick={() => setOpen((v) => !v)}
              title={atLimit ? `Compare limit ${MAX_COMPARE}` : 'Compare overlay'}
              className={cn(
                'flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-colors',
                panel.compareWith.length > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}>
        <Layers className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        Compare{panel.compareWith.length > 0 ? ` · ${panel.compareWith.length}` : ''}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-border/70 glass-strong shadow-glow">
          {panel.compareWith.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">
              {panel.compareWith.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                  {s}
                  <button type="button" onClick={() => ws.removePanelCompare(panel.id, s)} aria-label={`Remove ${s}`}>
                    <X className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => ws.clearPanelCompare(panel.id)}
                      className="text-[10px] text-muted-foreground hover:text-rose-300">
                clear
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 border-b border-border/60 px-3">
            <Search className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <input
              ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Add overlay…"
              className="w-full bg-transparent py-2 text-xs outline-none placeholder:text-muted-foreground/60"
              disabled={atLimit}
            />
          </div>

          <div className="max-h-[40vh] overflow-y-auto p-1">
            {atLimit && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Compare limit reached ({MAX_COMPARE}). Remove one to add another.
              </p>
            )}
            {!atLimit && results.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No matches</p>
            )}
            {!atLimit && results.map((m) => (
              <button key={m.symbol} type="button"
                      onClick={() => ws.addPanelCompare(panel.id, m.symbol)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/40">
                <span className="truncate">{m.display_name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{m.symbol}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
