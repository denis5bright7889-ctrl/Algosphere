'use client'

/**
 * Workspace symbol sidebar — registry-driven search + favorites + recents
 * + asset-class shortcuts. Click a symbol to load it into the active
 * panel; star to (un)favorite; / to focus search.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Star, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from './WorkspaceProvider'
import { symbolRegistry, symbolByCode } from '@/lib/symbol-registry'
import { ASSET_CLASS_LABEL, ASSET_CLASS_ORDER } from '@/lib/symbol-groups'
import type { AssetClass } from '@/lib/market-universe'

const REGISTRY = symbolRegistry()

export default function SymbolSidebar() {
  const ws = useWorkspace()
  const [q, setQ] = useState('')
  const [classFilter, setClassFilter] = useState<AssetClass | 'all'>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  // Global "/" focuses the sidebar search when the workspace is mounted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault(); inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    return REGISTRY
      .filter((m) => m.enabled && m.chart_supported)
      .filter((m) => classFilter === 'all' || m.asset_class === classFilter)
      .filter((m) => !term || (m.symbol + ' ' + m.display_name + ' ' + (m.sector ?? '')).toLowerCase().includes(term))
      .slice(0, 60)
  }, [q, classFilter])

  const favRows = ws.state.favorites
    .map((s) => symbolByCode(s))
    .filter((m): m is NonNullable<typeof m> => !!m)

  const recentRows = ws.state.recents
    .map((s) => symbolByCode(s))
    .filter((m): m is NonNullable<typeof m> => !!m)

  function pick(symbol: string, ac: AssetClass) {
    ws.setPanelSymbol(ws.activePanel.id, symbol, ac)
    ws.pushRecent(symbol)
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border/60 bg-card/30">
      {/* Search */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <input
          ref={inputRef}
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search… (press /)"
          aria-label="Search symbols"
          className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Asset-class shortcuts */}
      <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">
        <ClassChip on={classFilter === 'all'} onClick={() => setClassFilter('all')} label="All" />
        {ASSET_CLASS_ORDER.map((a) => (
          <ClassChip key={a} on={classFilter === a} onClick={() => setClassFilter(a)} label={ASSET_CLASS_LABEL[a]} />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {favRows.length > 0 && (
          <Section title="Favorites" icon={<Star className="h-3 w-3" strokeWidth={2} aria-hidden />}>
            {favRows.map((m) => (
              <Row key={`f-${m.symbol}`} symbol={m.symbol} name={m.display_name} ac={m.asset_class}
                   isFav onPick={() => pick(m.symbol, m.asset_class)} onStar={() => ws.toggleFavorite(m.symbol)} />
            ))}
          </Section>
        )}

        {recentRows.length > 0 && (
          <Section title="Recent" icon={<History className="h-3 w-3" strokeWidth={2} aria-hidden />}>
            {recentRows.map((m) => (
              <Row key={`r-${m.symbol}`} symbol={m.symbol} name={m.display_name} ac={m.asset_class}
                   isFav={ws.isFavorite(m.symbol)} onPick={() => pick(m.symbol, m.asset_class)}
                   onStar={() => ws.toggleFavorite(m.symbol)} />
            ))}
          </Section>
        )}

        <Section title={q ? 'Results' : 'Registry'}>
          {results.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No matches</p>
          )}
          {results.map((m) => (
            <Row key={`s-${m.symbol}`} symbol={m.symbol} name={m.display_name} ac={m.asset_class}
                 isFav={ws.isFavorite(m.symbol)} onPick={() => pick(m.symbol, m.asset_class)}
                 onStar={() => ws.toggleFavorite(m.symbol)} />
          ))}
        </Section>
      </div>
    </aside>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/40">
      <h4 className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        {icon}{title}
      </h4>
      <div className="px-1 pb-2">{children}</div>
    </section>
  )
}

function Row({
  symbol, name, ac, isFav, onPick, onStar,
}: {
  symbol: string; name: string; ac: AssetClass; isFav: boolean
  onPick: () => void; onStar: () => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-md px-1 transition-colors hover:bg-accent/40">
      <button type="button" onClick={onPick}
              className="flex flex-1 items-center justify-between gap-2 truncate py-1 text-left text-xs">
        <span className="truncate font-semibold">{name}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{symbol}</span>
      </button>
      <button type="button" onClick={onStar}
              aria-label={isFav ? 'Unfavorite' : 'Favorite'}
              className={cn('shrink-0 p-1', isFav ? 'text-amber-300' : 'text-muted-foreground/40 hover:text-amber-300')}>
        <Star className="h-3 w-3" strokeWidth={2} fill={isFav ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </div>
  )
}

function ClassChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} {...{ 'aria-pressed': on }}
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-colors',
              on ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                 : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}>
      {label}
    </button>
  )
}
