'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Search, Loader2, Check, Plus, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type CatalogClass = 'forex' | 'commodities' | 'stocks' | 'indices' | 'etf' | 'crypto'

interface CatalogRow {
  symbol:    string
  label:     string
  context?:  string
  currency?: string
}
interface CatalogResp {
  ok:        boolean
  class:     CatalogClass
  total:     number
  returned:  number
  truncated: boolean
  rows:      CatalogRow[]
  error?:    string
}

interface Props {
  /** The asset class to browse — driven by MarketHub's active tab. */
  cls:    CatalogClass
  /** Label of that class (e.g. "Forex"). */
  title:  string
  /** Closes the browser. */
  onClose: () => void
}

const CACHE: Partial<Record<CatalogClass, CatalogResp>> = {}

/**
 * Catalog browser — opens as a modal sheet over MarketHub. Lists the
 * full Twelve Data reference catalog for the active asset class with
 * client-side search + a "Pin" action that POSTs to /api/watchlist.
 *
 * Honest by design:
 *  - No fake quotes here. Pricing only happens after pinning, via the
 *    universe quote pipeline. Listing thousands of catalog rows with
 *    live prices would burn the provider quota and lie about freshness.
 *  - Engine errors surface verbatim ("HTTP 429", "TWELVE_DATA_API_KEY
 *    not configured") — we never silently render an empty list as if
 *    the universe were genuinely empty.
 */
export default function CatalogBrowser({ cls, title, onClose }: Props) {
  const [data, setData]   = useState<CatalogResp | null>(CACHE[cls] ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!CACHE[cls])
  const [query, setQuery] = useState('')
  const [pinning, setPinning] = useState<string | null>(null)
  const [pinned, setPinned]   = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  // Esc + autofocus search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    inputRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // Fetch catalog once per class (cached in module-level CACHE for the session).
  useEffect(() => {
    if (CACHE[cls]) return
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/market/catalog/${cls}?limit=2000`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null) as CatalogResp | { error: string } | null
        if (!alive) return
        if (!j) { setError('Bad response from /api/market/catalog'); setLoading(false); return }
        if ('error' in j && !('rows' in j)) { setError(j.error); setLoading(false); return }
        const ok = j as CatalogResp
        CACHE[cls] = ok
        setData(ok)
        setError(ok.ok ? null : (ok.error ?? 'Catalog upstream error'))
        setLoading(false)
      })
      .catch((e) => { if (alive) { setError(e?.message ?? 'fetch failed'); setLoading(false) } })
    return () => { alive = false }
  }, [cls])

  const filtered = useMemo(() => {
    const rows = data?.rows ?? []
    const q = query.trim().toLowerCase()
    if (!q) return rows.slice(0, 200)
    const out: CatalogRow[] = []
    for (const r of rows) {
      if (
        r.symbol.toLowerCase().includes(q)
        || r.label.toLowerCase().includes(q)
        || (r.context?.toLowerCase().includes(q) ?? false)
      ) out.push(r)
      if (out.length >= 400) break
    }
    return out
  }, [data, query])

  async function pin(row: CatalogRow) {
    if (pinned.has(row.symbol)) return
    setPinning(row.symbol)
    try {
      const res = await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          symbol:          row.symbol,
          asset_class:     cls,
          provider:        'twelvedata',
          provider_symbol: row.symbol,
          label:           row.label,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j?.error ?? `Pin failed (HTTP ${res.status})`)
      } else {
        setPinned((s) => new Set(s).add(row.symbol))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pin failed')
    } finally {
      setPinning(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[80]">
      {/* Overlay */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Browse ${title} catalog`}
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-col bg-card border-t border-border/70 shadow-2xl',
          'h-[88dvh] sm:h-[80dvh] sm:inset-y-12 sm:left-1/2 sm:bottom-auto sm:-translate-x-1/2',
          'sm:w-[640px] sm:max-w-[94vw] sm:rounded-2xl sm:border',
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight">
              Browse <span className="text-gradient">{title}</span>
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Full Twelve Data catalog · pin any symbol to your watchlist
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className="relative border-b border-border/60 px-4 py-3">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${title.toLowerCase()} symbol or name…`}
            className="w-full rounded-lg border border-border/70 bg-background/60 pl-9 pr-3 py-2 text-sm focus:border-amber-500/50 focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
              Loading catalog…
            </div>
          )}

          {!loading && error && (
            <div className="m-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && data && (
            <>
              <p className="px-4 pt-2 text-[10px] text-muted-foreground">
                {filtered.length.toLocaleString()} of {data.total.toLocaleString()}
                {query ? ' match' : ' total'}
                {data.truncated ? ' · upstream truncated' : ''}
              </p>
              <ul className="divide-y divide-border/40 px-2 pb-4 pt-2">
                {filtered.map((r) => {
                  const isPinned  = pinned.has(r.symbol)
                  const isPinning = pinning === r.symbol
                  return (
                    <li
                      key={r.symbol}
                      className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/30"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.label}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="font-mono">{r.symbol}</span>
                          {r.context && <span className="opacity-70">·</span>}
                          {r.context && <span className="truncate">{r.context}</span>}
                          {r.currency && <span className="opacity-70">·</span>}
                          {r.currency && <span>{r.currency}</span>}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => pin(r)}
                        disabled={isPinned || isPinning}
                        aria-label={isPinned ? 'Pinned' : `Pin ${r.label}`}
                        className={cn(
                          'inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold transition-colors',
                          isPinned
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-border bg-background/60 text-foreground hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-60',
                        )}
                      >
                        {isPinning
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
                          : isPinned
                            ? <Check  className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                            : <Plus   className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />}
                        {isPinned ? 'Pinned' : isPinning ? 'Pinning' : 'Pin'}
                      </button>
                    </li>
                  )
                })}
                {!loading && filtered.length === 0 && (
                  <li className="px-4 py-8 text-center text-xs text-muted-foreground">
                    {query ? 'No matches.' : 'Catalog is empty.'}
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
